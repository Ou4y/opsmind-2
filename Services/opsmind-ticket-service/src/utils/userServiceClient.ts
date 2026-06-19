import { config } from "../config";
import { logger } from "../config/logger";

interface UserServiceResponse {
  id: string;
  name: string;
  fullName?: string | null;
  email?: string;
  username?: string | null;
  role?: string;
}

/**
 * User details with full information including email
 */
export interface UserDetails {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export interface UserDisplayDetails {
  id: string;
  name: string | null;
  fullName: string | null;
  email: string | null;
  username: string | null;
  role: string | null;
}

/**
 * Temporary mock mapping for technician names.
 * TODO: Remove when User Service is fully integrated.
 */
const MOCK_TECHNICIAN_NAMES: Record<string, string> = {
  "1": "Ahmed Hassan",
  "2": "Sara Ali",
  "3": "Mohammed Ibrahim",
  "4": "Fatima Ahmed",
  "it-1": "Ismail Nasser",
  "tech-001": "Omar Khaled",
  "tech-002": "Layla Hassan",
  "tech-003": "Youssef Mahmoud",
};

/**
 * Fetch technician/user name from the User Service.
 * Falls back to mock data if service is unavailable.
 * Returns null if the service is unavailable and no mock exists.
 * This is a non-blocking operation - failures are logged but not propagated.
 */
export async function fetchTechnicianName(technicianId: string): Promise<string | null> {
  try {
    const url = `${config.userService.url}/users/${technicianId}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.workflowService.internalApiToken) {
      headers["x-internal-token"] = config.workflowService.internalApiToken;
    }
    
    logger.debug("Fetching technician name from User Service", {
      technicianId,
      url,
    });

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn("Technician not found in User Service", { technicianId });
        return null;
      }
      
      logger.warn("User Service returned non-OK status", {
        status: response.status,
        technicianId,
      });
      return null;
    }

    const data = (await response.json()) as UserServiceResponse;
    
    logger.debug("Technician name fetched successfully", {
      technicianId,
      name: data.name,
    });

    return data.name || null;
  } catch (err) {
    // Graceful degradation - try mock data first, then return null
    logger.warn("Failed to fetch technician name from User Service, trying mock data", {
      technicianId,
      error: err instanceof Error ? err.message : String(err),
    });
    
    // Fallback to mock data
    const mockName = MOCK_TECHNICIAN_NAMES[technicianId];
    if (mockName) {
      logger.debug("Using mock technician name", { technicianId, name: mockName });
      return mockName;
    }
    
    return null;
  }
}

/**
 * Batch fetch technician names for multiple IDs.
 * Returns a map of technicianId -> name.
 * Missing or failed lookups will not be in the map.
 */
export async function fetchTechnicianNames(
  technicianIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(technicianIds.filter(Boolean)));
  
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const results = await Promise.allSettled(
    uniqueIds.map(async (id) => {
      const name = await fetchTechnicianName(id);
      return { id, name };
    })
  );

  const nameMap = new Map<string, string>();
  
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.name) {
      nameMap.set(result.value.id, result.value.name);
    }
  }

  return nameMap;
}

function normalizeUserDisplayDetails(user: UserServiceResponse): UserDisplayDetails | null {
  const id = typeof user?.id === "string" ? user.id.trim() : "";
  if (!id) return null;

  const name = typeof user.name === "string" && user.name.trim() ? user.name.trim() : null;
  const fullName = typeof user.fullName === "string" && user.fullName.trim() ? user.fullName.trim() : name;
  const email = typeof user.email === "string" && user.email.trim() ? user.email.trim() : null;
  const username = typeof user.username === "string" && user.username.trim() ? user.username.trim() : null;
  const role = typeof user.role === "string" && user.role.trim() ? user.role.trim() : null;

  return {
    id,
    name,
    fullName,
    email,
    username,
    role,
  };
}

/**
 * Batch fetch display details for users/requesters.
 * Uses the auth-service internal batch endpoint in chunks to avoid per-ticket N+1 lookups.
 */
export async function fetchUsersByIds(userIds: string[]): Promise<Map<string, UserDisplayDetails>> {
  const uniqueIds = Array.from(
    new Set(
      userIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  const userMap = new Map<string, UserDisplayDetails>();
  if (uniqueIds.length === 0) return userMap;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.workflowService.internalApiToken) {
    headers["x-internal-token"] = config.workflowService.internalApiToken;
  }

  const chunkSize = 100;
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const ids = uniqueIds.slice(index, index + chunkSize);

    try {
      const response = await fetch(`${config.userService.url}/internal/users/batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        logger.warn("User Service batch lookup returned non-OK status", {
          status: response.status,
          requestedUserCount: ids.length,
        });
        continue;
      }

      const payload = (await response.json()) as { data?: UserServiceResponse[] };
      const users = Array.isArray(payload?.data) ? payload.data : [];
      for (const user of users) {
        const normalized = normalizeUserDisplayDetails(user);
        if (normalized) {
          userMap.set(normalized.id, normalized);
        }
      }
    } catch (err) {
      logger.warn("Failed to batch fetch users from User Service", {
        requestedUserCount: ids.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return userMap;
}

/**
 * Fetch complete user details including email from the User Service.
 * 
 * @param userId - The user/technician ID to fetch
 * @returns User details with name and email, or null if not found
 */
export async function fetchUserDetails(userId: string): Promise<UserDetails | null> {
  try {
    const url = `${config.userService.url}/users/${userId}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.workflowService.internalApiToken) {
      headers["x-internal-token"] = config.workflowService.internalApiToken;
    }
    
    logger.debug("Fetching user details from User Service", {
      userId,
      url,
    });

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn("User not found in User Service", { userId });
        return null;
      }
      
      logger.warn("User Service returned non-OK status", {
        status: response.status,
        userId,
      });
      return null;
    }

    const data = (await response.json()) as UserServiceResponse;
    
    if (!data.name || !data.email) {
      logger.warn("User details incomplete (missing name or email)", {
        userId,
        hasName: !!data.name,
        hasEmail: !!data.email,
      });
      return null;
    }

    logger.debug("User details fetched successfully", {
      userId,
      name: data.name,
      email: data.email,
    });

    return {
      id: userId,
      name: data.name,
      email: data.email,
      role: data.role,
    };
  } catch (err) {
    logger.warn("Failed to fetch user details from User Service", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
