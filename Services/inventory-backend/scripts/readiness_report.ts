import { prisma } from '../src/lib/prisma';
import { buildInventoryAiReadinessReport } from '../src/services/asset-intelligence';

async function main() {
  try {
    const report = await buildInventoryAiReadinessReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error: any) => {
  console.error(`[InventoryAIReadiness] report failed: ${error?.message || error}`);
  process.exitCode = 1;
  await prisma.$disconnect();
});
