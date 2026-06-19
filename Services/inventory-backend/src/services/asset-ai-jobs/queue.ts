import amqp, { Channel, ChannelModel, ConsumeMessage, Options } from 'amqplib';
import {
  INVENTORY_AI_JOBS_EXCHANGE,
  INVENTORY_AI_JOB_RETRY_DELAYS_MS,
  getInventoryAiJobDlqName,
  getInventoryAiJobDlqRoutingKey,
  getInventoryAiJobQueueName,
  getInventoryAiJobRetryQueueName,
  getInventoryAiJobRetryRoutingKey,
} from './constants';
import { INVENTORY_AI_JOB_TYPES, type InventoryAiJobMessage, type InventoryAiJobType } from './types';

type QueueMessageHandler = (message: InventoryAiJobMessage, raw: ConsumeMessage, channel: Channel) => Promise<void>;

class InventoryAiJobQueueService {
  private connection: ChannelModel | null = null;
  private publisherChannel: Channel | null = null;
  private consumerChannels = new Set<Channel>();
  private topologyAsserted = false;

  private readonly rabbitUri = String(process.env.RABBITMQ_URI || '').trim();

  async connect() {
    if (this.connection && this.publisherChannel) return;

    if (!this.rabbitUri) {
      throw new Error('RABBITMQ_URI is required for inventory AI job queue');
    }

    this.connection = await amqp.connect(this.rabbitUri);
    this.publisherChannel = await this.connection.createChannel();
    await this.assertTopology(this.publisherChannel);
  }

  private async assertTopology(channel: Channel) {
    if (this.topologyAsserted) return;

    await channel.assertExchange(INVENTORY_AI_JOBS_EXCHANGE, 'topic', { durable: true });

    for (const jobType of INVENTORY_AI_JOB_TYPES) {
      const queueName = getInventoryAiJobQueueName(jobType);
      const dlqName = getInventoryAiJobDlqName(jobType);
      const dlqRoutingKey = getInventoryAiJobDlqRoutingKey(jobType);

      await channel.assertQueue(dlqName, { durable: true });
      await channel.bindQueue(dlqName, INVENTORY_AI_JOBS_EXCHANGE, dlqRoutingKey);

      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': INVENTORY_AI_JOBS_EXCHANGE,
          'x-dead-letter-routing-key': dlqRoutingKey,
        },
      });
      await channel.bindQueue(queueName, INVENTORY_AI_JOBS_EXCHANGE, jobType);

      for (let index = 0; index < INVENTORY_AI_JOB_RETRY_DELAYS_MS.length; index += 1) {
        const retryLevel = index + 1;
        const retryDelay = INVENTORY_AI_JOB_RETRY_DELAYS_MS[index];
        const retryQueue = getInventoryAiJobRetryQueueName(jobType, retryLevel);
        const retryRoutingKey = getInventoryAiJobRetryRoutingKey(jobType, retryLevel);

        await channel.assertQueue(retryQueue, {
          durable: true,
          arguments: {
            'x-message-ttl': retryDelay,
            'x-dead-letter-exchange': INVENTORY_AI_JOBS_EXCHANGE,
            'x-dead-letter-routing-key': jobType,
          },
        });
        await channel.bindQueue(retryQueue, INVENTORY_AI_JOBS_EXCHANGE, retryRoutingKey);
      }
    }

    this.topologyAsserted = true;
  }

  private encodeMessage(message: InventoryAiJobMessage) {
    return Buffer.from(JSON.stringify(message), 'utf-8');
  }

  private publishOptions(): Options.Publish {
    return {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
    };
  }

  async publishJob(jobType: InventoryAiJobType, message: InventoryAiJobMessage) {
    await this.connect();
    if (!this.publisherChannel) throw new Error('Inventory AI publisher channel unavailable');
    const published = this.publisherChannel.publish(
      INVENTORY_AI_JOBS_EXCHANGE,
      jobType,
      this.encodeMessage(message),
      this.publishOptions(),
    );
    if (!published) {
      console.warn(`[InventoryAIJobs] publish backpressure for ${jobType}`);
    }
  }

  async publishRetry(jobType: InventoryAiJobType, retryLevel: number, message: InventoryAiJobMessage) {
    await this.connect();
    if (!this.publisherChannel) throw new Error('Inventory AI publisher channel unavailable');
    const routingKey = getInventoryAiJobRetryRoutingKey(jobType, retryLevel);
    const published = this.publisherChannel.publish(
      INVENTORY_AI_JOBS_EXCHANGE,
      routingKey,
      this.encodeMessage(message),
      this.publishOptions(),
    );
    if (!published) {
      console.warn(`[InventoryAIJobs] retry publish backpressure for ${jobType} level=${retryLevel}`);
    }
  }

  async publishDlq(jobType: InventoryAiJobType, message: InventoryAiJobMessage) {
    await this.connect();
    if (!this.publisherChannel) throw new Error('Inventory AI publisher channel unavailable');
    const routingKey = getInventoryAiJobDlqRoutingKey(jobType);
    this.publisherChannel.publish(
      INVENTORY_AI_JOBS_EXCHANGE,
      routingKey,
      this.encodeMessage(message),
      this.publishOptions(),
    );
  }

  async consume(jobType: InventoryAiJobType, prefetch: number, handler: QueueMessageHandler) {
    await this.connect();
    if (!this.connection) throw new Error('Inventory AI queue connection unavailable');

    const channel = await this.connection.createChannel();
    this.consumerChannels.add(channel);
    await this.assertTopology(channel);
    await channel.prefetch(Math.max(1, prefetch));

    const queueName = getInventoryAiJobQueueName(jobType);
    await channel.consume(
      queueName,
      async (msg) => {
        if (!msg) return;
        let parsed: InventoryAiJobMessage | null = null;
        try {
          parsed = JSON.parse(msg.content.toString('utf-8')) as InventoryAiJobMessage;
        } catch (error: any) {
          console.error(`[InventoryAIJobs] invalid message on ${jobType}: ${error?.message || error}`);
          channel.ack(msg);
          return;
        }

        try {
          await handler(parsed, msg, channel);
        } catch (error: any) {
          console.error(`[InventoryAIJobs] unhandled consumer error ${jobType}: ${error?.message || error}`);
          channel.ack(msg);
        }
      },
      { noAck: false },
    );
  }

  async close() {
    for (const consumerChannel of this.consumerChannels) {
      try {
        await consumerChannel.close();
      } catch {
        // ignore close errors
      }
    }
    this.consumerChannels.clear();

    if (this.publisherChannel) {
      try {
        await this.publisherChannel.close();
      } catch {
        // ignore
      }
      this.publisherChannel = null;
    }

    if (this.connection) {
      try {
        await this.connection.close();
      } catch {
        // ignore
      }
      this.connection = null;
    }
    this.topologyAsserted = false;
  }
}

export const InventoryAiJobQueue = new InventoryAiJobQueueService();
