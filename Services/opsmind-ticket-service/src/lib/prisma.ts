import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import { logger } from "../config/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDev ? ["query", "error", "warn"] : ["error"],
  });

if (config.isDev) {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error("Database connection failed", { error });
    return false;
  }
}
