import { TicketRoutingStateRepository } from '../repositories/TicketRoutingStateRepository';
import { EscalationService } from '../services/EscalationService';

/**
 * SLA Monitor Job (TypeScript)
 *
 * Periodically checks for SLA breaches and auto-escalates tickets.
 * Runs as setInterval inside the Node process.
 */

const SLA_LIMITS: Record<string, number> = {
  CRITICAL: parseInt(process.env.SLA_CRITICAL || '60', 10),
  HIGH: parseInt(process.env.SLA_HIGH || '120', 10),
  MEDIUM: parseInt(process.env.SLA_MEDIUM || '240', 10),
  LOW: parseInt(process.env.SLA_LOW || '480', 10),
};

const CHECK_INTERVAL_MS = 60_000; // every 1 minute

let intervalId: NodeJS.Timeout | null = null;

export function startSlaMonitor(): void {
  console.log('[SLA Monitor] Starting SLA monitor job...');

  intervalId = setInterval(async () => {
    try {
      console.log(`[SLA Monitor] Running SLA check at ${new Date().toISOString()}`);
      // Future implementation:
      // 1. Query sla_tracking for upcoming / breached deadlines
      // 2. For breached tickets, call EscalationService.escalateOnSLABreach()
      // 3. Log results
    } catch (error) {
      console.error('[SLA Monitor] Error during SLA check:', error);
    }
  }, CHECK_INTERVAL_MS);
}

export function stopSlaMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[SLA Monitor] Stopped.');
  }
}
