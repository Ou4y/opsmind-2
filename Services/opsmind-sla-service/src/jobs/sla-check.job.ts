import { config } from "../config";
import { logger } from "../config/logger";
import { slaService } from "../modules/sla/sla.service";

let intervalRef: NodeJS.Timeout | null = null;

export function startSlaMonitorJob() {
  if (intervalRef) return;

  intervalRef = setInterval(async () => {
    try {
      const result = await slaService.runMonitorCycle();
      logger.info("SLA monitor cycle completed", result);
    } catch (error) {
      logger.error("SLA monitor cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, config.sla.checkIntervalMs);

  logger.info("SLA monitor job started", {
    everyMs: config.sla.checkIntervalMs,
  });
}

export function stopSlaMonitorJob() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
  }
}
