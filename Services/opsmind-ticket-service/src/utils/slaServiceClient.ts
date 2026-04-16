import { logger } from "../config/logger";

const SLA_SERVICE_URL = process.env.SLA_SERVICE_URL || "http://opsmind-sla-service:3004";

/**
 * SLA status update payload
 */
export interface SlaStatusPayload {
  ticketStatus: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  assignedTo: string;
  title: string;
  technician: {
    id: string;
    name: string;
    email: string;
  };
  supervisor: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Update SLA status via PATCH /sla/tickets/{ticketId}/status
 * 
 * @param ticketId - The ticket ID
 * @param payload - SLA status update payload
 * @returns true if successful, false otherwise
 */
export async function updateSlaStatus(
  ticketId: string,
  payload: SlaStatusPayload
): Promise<boolean> {
  try {
    const url = `${SLA_SERVICE_URL}/sla/tickets/${ticketId}/status`;
    
    logger.debug("Updating SLA status", {
      ticketId,
      url,
      status: payload.ticketStatus,
    });

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.warn("SLA Service returned non-OK status", {
        ticketId,
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    logger.info("SLA status updated successfully", {
      ticketId,
      ticketStatus: payload.ticketStatus,
    });

    return true;
  } catch (err) {
    logger.warn("Failed to update SLA status", {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
