const amqp = require("amqplib");

const EXCHANGE_NAME = "opsmind.events";
const EXCHANGE_TYPE = "topic";

async function connectRabbitMQ(retries = 10, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Trying to connect to RabbitMQ (${i + 1}/${retries})...`);


      const RABBITMQ_URL = "amqp://opsmind:opsmind@opsmind-rabbitmq:5672";
         console.log("RABBITMQ_URL =", RABBITMQ_URL);
      const connection = await amqp.connect(RABBITMQ_URL, {
        heartbeat: 30,
      });

      connection.on("error", (err) => {
        console.error("RabbitMQ connection error:", err.message);
      });

      connection.on("close", () => {
        console.warn("RabbitMQ connection closed. Reconnecting...");
        setTimeout(connectRabbitMQ, 5000);
      });

      const channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
        durable: true,
      });

      console.log("Connected to RabbitMQ successfully");

      return { channel, EXCHANGE_NAME };
    } catch (err) {
      console.warn(`RabbitMQ not ready. Retry in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw new Error("Unable to connect to RabbitMQ after many retries");
}

module.exports = connectRabbitMQ;
