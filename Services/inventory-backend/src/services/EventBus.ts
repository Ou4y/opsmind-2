import amqp from 'amqplib';

export class EventBusService {
  private connection: any = null;
  private channel: any = null;
  private EXCHANGE_NAME = 'opsmind_events';

  async connect() {
    try {
      // 1. Get the URI from the environment (.env file), or fall back to Docker default
      const rabbitURI = process.env.RABBITMQ_URI || 'amqp://opsmind:opsmind@opsmind-rabbitmq:5672';
      
      console.log(`🔌 Attempting to connect to RabbitMQ at: ${rabbitURI}`);

      this.connection = await amqp.connect(rabbitURI);
      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: false });

      console.log('✅ Connected to RabbitMQ Event Bus');
    } catch (error) {
      console.error('❌ RabbitMQ Connection Failed.');
      console.error('Error Details:', error);
      // In production, you might want to retry rather than exit
      process.exit(1); 
    }
  }

  async publish(topic: string, data: any) {
    if (!this.channel) {
        console.warn(`[EVENT BUS] ⚠️ Cannot publish: No channel established for ${topic}`);
        return;
    }
    try {
      const message = JSON.stringify(data);
      this.channel.publish(this.EXCHANGE_NAME, topic, Buffer.from(message));
      console.log(`[EVENT BUS] 📤 Sent: ${topic}`);
    } catch (err) {
      console.error(`[EVENT BUS] ❌ Failed to send ${topic}:`, err);
    }
  }

  async subscribe(topic: string, callback: (data: any) => void) {
    if (!this.channel) return;
    try {
      const q = await this.channel.assertQueue('', { exclusive: true });
      await this.channel.bindQueue(q.queue, this.EXCHANGE_NAME, topic);
      this.channel.consume(q.queue, (msg: any) => {
        if (msg) callback(JSON.parse(msg.content.toString()));
      }, { noAck: true });
      console.log(`[EVENT BUS] 🎧 Subscribed to: ${topic}`);
    } catch (err) {
      console.error(`[EVENT BUS] ❌ Failed to subscribe ${topic}:`, err);
    }
  }
}

export const EventBus = new EventBusService();
