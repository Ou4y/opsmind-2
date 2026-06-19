import { logger } from "../config/logger";
import { config } from "../config";

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || "http://opsmind-workflow:3003";

/**
 * Supervisor details from Workflow Service
 */
export interface SupervisorDetails {
  id: string;
  name: string;
  email: string;
}

/**
 * Fetch supervisor details from the Workflow Service.
 * 
 * The Workflow Service maintains technician hierarchy information
 * and can provide the active supervisor for notifications.
 * 
 * @returns Supervisor details (id, name, email) or null if not available
 */
export async function fetchSupervisor(): Promise<SupervisorDetails | null> {
  try {
    const url = `${WORKFLOW_SERVICE_URL}/workflow/supervisor`;
    
    logger.debug("Fetching supervisor from Workflow Service", { url });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const internalToken = config.workflowService.internalApiToken?.trim();
    if (internalToken) {
      headers["x-internal-token"] = internalToken;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    if (!response.ok) {
      logger.warn("Workflow Service returned non-OK status when fetching supervisor", {
        status: response.status,
      });
      return null;
    }

    const data = await response.json();
    
    if (!data || !data.id || !data.name || !data.email) {
      logger.warn("Supervisor details incomplete from Workflow Service", {
        hasId: !!data?.id,
        hasName: !!data?.name,
        hasEmail: !!data?.email,
      });
      return null;
    }

    logger.debug("Supervisor fetched successfully", {
      supervisorId: data.id,
      name: data.name,
    });

    return {
      id: String(data.id),
      name: data.name,
      email: data.email,
    };
  } catch (err) {
    logger.warn("Failed to fetch supervisor from Workflow Service", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Sync ticket snapshot to Workflow Service cache.
 */
export async function syncWorkflowTicket(ticket: any, source: string): Promise<void> {
  const url = `${WORKFLOW_SERVICE_URL}/workflow/internal/tickets/sync`;

  const payload = {
    source: source || "ticket-service",
    ticket: {
      id: ticket.id,
      requester_id: ticket.requester_id ?? null,
      title: ticket.title ?? null,
      description: ticket.description ?? null,
      affected_device_id: ticket.affected_device_id ?? null,
      affected_device_name: ticket.affected_device_name ?? null,
      os_type: ticket.os_type ?? null,
      issue_scope: ticket.issue_scope ?? null,
      remote_support_consent: ticket.remote_support_consent ?? false,
      remote_support_consent_at: ticket.remote_support_consent_at ?? null,
      remote_support_consent_by: ticket.remote_support_consent_by ?? null,
      ai_agent_eligible: ticket.ai_agent_eligible ?? false,
      ai_agent_eligibility_reason: ticket.ai_agent_eligibility_reason ?? null,
      assigned_to: ticket.assigned_to ?? null,
      assigned_to_level: ticket.assigned_to_level ?? null,
      priority: ticket.priority ?? null,
      support_level: ticket.support_level ?? null,
      status: ticket.status ?? null,
      escalation_count: ticket.escalation_count ?? 0,
      resolution_summary: ticket.resolution_summary ?? null,
      created_at: ticket.created_at ?? null,
      updated_at: ticket.updated_at ?? null,
      closed_at: ticket.closed_at ?? null,
      resolved_at: ticket.resolved_at ?? null,
      type_of_request: ticket.type_of_request ?? null,
      latitude: ticket.latitude ?? null,
      longitude: ticket.longitude ?? null,
    },
  };

  logger.debug("Syncing ticket snapshot to Workflow Service", {
    ticketId: ticket.id,
    url,
  });

  const internalToken = config.workflowService.internalApiToken?.trim();
  if (!internalToken) {
    logger.warn("INTERNAL_API_TOKEN is not configured; refusing workflow sync call", {
      ticketId: ticket.id,
      url,
    });
    throw new Error("Workflow sync failed: INTERNAL_API_TOKEN is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  headers["x-internal-token"] = internalToken;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Workflow sync failed: ${response.status} ${body}`);
  }
}
