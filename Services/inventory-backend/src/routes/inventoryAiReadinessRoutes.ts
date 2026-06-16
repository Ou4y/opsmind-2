import express, { Request, Response } from 'express';
import { buildInventoryAiReadinessReport } from '../services/asset-intelligence';

const router = express.Router();

router.get('/readiness', async (_req: Request, res: Response) => {
  try {
    const report = await buildInventoryAiReadinessReport();
    return res.json(report);
  } catch (error: any) {
    console.error(`[InventoryAIReadiness] failed: ${error?.message || error}`);
    return res.status(500).json({
      message: 'Failed to build inventory AI readiness report',
      error: error?.message || String(error),
    });
  }
});

export default router;
