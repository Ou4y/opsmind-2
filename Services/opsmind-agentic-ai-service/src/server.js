require("dotenv").config();

const app = require("./app");
const prisma = require("./db/prisma");

const PORT = Number(process.env.PORT || 4010);
const SERVICE_NAME = process.env.SERVICE_NAME || "opsmind-agentic-ai-service";

const server = app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${SERVICE_NAME} received ${signal}. Shutting down...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error("Failed to disconnect Prisma client:", error);
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
