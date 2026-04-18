process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://opsmind:opsmind@localhost:3306/sla_db";
process.env.RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://opsmind:opsmind@localhost:5672";
