jest.mock("amqplib", () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
  },
}));

import amqp from "amqplib";
import { EventBusService } from "../src/services/EventBus";

describe("EventBusService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("connects to RabbitMQ and asserts topic exchange", async () => {
    const assertExchange = jest.fn().mockResolvedValue(undefined);
    const createChannel = jest.fn().mockResolvedValue({ assertExchange });
    (amqp.connect as unknown as jest.Mock).mockResolvedValue({ createChannel });

    process.env.RABBITMQ_URI = "amqp://local-test";
    const service = new EventBusService();

    await service.connect();

    expect(amqp.connect).toHaveBeenCalledWith("amqp://local-test");
    expect(assertExchange).toHaveBeenCalledWith("opsmind_events", "topic", { durable: false });
  });

  it("publishes serialized payload when channel exists", async () => {
    const publish = jest.fn();
    const service = new EventBusService() as unknown as { channel: { publish: jest.Mock }; publish: (topic: string, data: unknown) => Promise<void> };
    service.channel = { publish };

    await service.publish("asset.created", { id: "A1" });

    expect(publish).toHaveBeenCalledWith(
      "opsmind_events",
      "asset.created",
      expect.any(Buffer)
    );
  });

  it("subscribes to topic and forwards parsed messages", async () => {
    const callback = jest.fn();
    const consume = jest.fn((_queue: string, handler: (msg: { content: Buffer }) => void) => {
      handler({ content: Buffer.from(JSON.stringify({ id: "A1" })) });
    });

    const channel = {
      assertQueue: jest.fn().mockResolvedValue({ queue: "auto-q" }),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume,
    };

    const service = new EventBusService() as unknown as {
      channel: typeof channel;
      subscribe: (topic: string, cb: (data: unknown) => void) => Promise<void>;
    };
    service.channel = channel;

    await service.subscribe("asset.updated", callback);

    expect(channel.assertQueue).toHaveBeenCalledWith("", { exclusive: true });
    expect(channel.bindQueue).toHaveBeenCalledWith("auto-q", "opsmind_events", "asset.updated");
    expect(callback).toHaveBeenCalledWith({ id: "A1" });
  });
});
