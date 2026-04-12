import { logger } from "../config/logger";

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

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
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
