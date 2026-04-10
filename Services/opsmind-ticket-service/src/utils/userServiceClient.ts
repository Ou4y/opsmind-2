import { config } from "../config";
import { logger } from "../config/logger";

interface UserServiceResponse {
  id: string;
  name: string;
  email?: string;
  role?: string;
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
    
    logger.debug("Fetching technician name from User Service", {
      technicianId,
      url,
    });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
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
