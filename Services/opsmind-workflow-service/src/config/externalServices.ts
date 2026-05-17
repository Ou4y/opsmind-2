import axios, { AxiosError, AxiosInstance } from 'axios';
import { ExternalTicket, ExternalUser } from '../interfaces/types';

/**
 * External Service Clients (TypeScript)
 *
 * - Docker container names used as hostnames
 * - Typed responses for type-safety
 * - Timeout configuration prevents hanging requests
 */

const AUTH_SERVICE_URL: string = process.env.AUTH_SERVICE_URL || 'http://opsmind-auth-service:3002';
const TICKET_SERVICE_URL: string = process.env.TICKET_SERVICE_URL || 'http://opsmind-ticket-service:3001';
const SLA_SERVICE_URL: string = process.env.SLA_SERVICE_URL || 'http://opsmind-sla-service:3004';

// ---------- Axios Instances ----------

export const authServiceClient: AxiosInstance = axios.create({
  baseURL: AUTH_SERVICE_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});

export const ticketServiceClient: AxiosInstance = axios.create({
  baseURL: TICKET_SERVICE_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});

export const slaServiceClient: AxiosInstance = axios.create({
  baseURL: SLA_SERVICE_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});

export interface ExternalCallContext {
  requestId?: string;
  caller?: string;
}

function normalizeTicketIds(ticketIds: string[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(ticketIds) ? ticketIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  );
}

function toErrorMeta(error: unknown) {
  const axiosError = error as AxiosError;
  return {
    message: axiosError?.message || String(error),
    status: axiosError?.response?.status,
    url: axiosError?.config?.url,
    method: axiosError?.config?.method,
  };
}

// ---------- Auth Service Helpers ----------

export async function validateUser(userId: number | string): Promise<ExternalUser> {
  const { data } = await authServiceClient.get<ExternalUser>(`/users/${userId}`);
  return data;
}

export async function getUserRole(userId: number | string): Promise<{ role: string }> {
  const { data } = await authServiceClient.get<{ role: string }>(`/users/${userId}/role`);
  return data;
}

/**
 * Get user details (id, email, role) from auth service
 */
export async function getUserDetails(userId: number | string): Promise<ExternalUser> {
  const { data } = await authServiceClient.get<ExternalUser>(`/users/${userId}`);
  return data;
}

// ---------- Ticket Service Helpers ----------

/**
 * Map internal workflow roles to the ticket-service SupportLevel enum.
 *   JUNIOR     → L1
 *   SENIOR     → L2
 *   SUPERVISOR → L3
 */
export function toSupportLevel(role: string): string {
  const map: Record<string, string> = {
    JUNIOR: 'L1',
    SENIOR: 'L2',
    SUPERVISOR: 'L3',
    ADMIN: 'L4',
    HEAD_OF_IT: 'L4',
  };
  return map[role] || 'L1';
}

export async function getTicket(ticketId: string): Promise<ExternalTicket> {
  const { data } = await ticketServiceClient.get<ExternalTicket>(`/tickets/${ticketId}`);
  return data;
}

/**
 * Get ticket details including title from ticket service
 */
export async function getTicketDetails(ticketId: string): Promise<any> {
  const { data } = await ticketServiceClient.get<any>(`/tickets/${ticketId}`);
  return data;
}

/**
 * Assign a ticket via PATCH /tickets/:id
 * Sends assigned_to (string), assigned_to_level (L1-L4), and optional status.
 */
export async function assignTicket(
  ticketId: string,
  userId: number | string,
  assignedToLevel: string = 'L1',
  status?: string,
  options?: {
    assignmentMethod?: string;
    assignmentReason?: string;
    performedBy?: number | string | null;
    performedByRole?: string | null;
    statusReason?: string | null;
  },
): Promise<any> {
  const url = `${TICKET_SERVICE_URL}/tickets/${ticketId}`;
  const payload: Record<string, unknown> = {
    assigned_to: String(userId),
    assigned_to_level: assignedToLevel,
  };
  if (status) {
    payload.status = status;
  }
  if (options?.assignmentMethod) {
    payload.assignment_method = options.assignmentMethod;
  }
  if (options?.assignmentReason) {
    payload.assignment_reason = options.assignmentReason;
  }
  if (options?.performedBy !== undefined && options?.performedBy !== null) {
    payload.performed_by = options.performedBy;
  }
  if (options?.performedByRole) {
    payload.performed_by_role = options.performedByRole;
  }
  if (options?.statusReason) {
    payload.status_reason = options.statusReason;
  }
  console.log(`[externalServices] PATCH ${url} | payload: ${JSON.stringify(payload)}`);
  const { data } = await ticketServiceClient.patch(`/tickets/${ticketId}`, payload);
  return data;
}

/**
 * Update only the status of a ticket via PATCH /tickets/:id
 */
export async function updateTicketStatus(ticketId: string, status: string): Promise<any> {
  const { data } = await ticketServiceClient.patch(`/tickets/${ticketId}`, { status });
  return data;
}

/**
 * Escalate a ticket via POST /tickets/:id/escalate
 * Body: { from_level, to_level, reason }
 */
export async function escalateTicketInService(
  ticketId: string,
  fromLevel: string,
  toLevel: string,
  reason: string,
): Promise<any> {
  const { data } = await ticketServiceClient.post(`/tickets/${ticketId}/escalate`, {
    from_level: fromLevel,
    to_level: toLevel,
    reason,
  });
  return data;
}

export async function getTicketAssignmentHistory(ticketId: string): Promise<any> {
  const { data } = await ticketServiceClient.get(`/tickets/${ticketId}/assignment-history`);
  return data;
}

export async function getTicketStatusHistory(ticketId: string): Promise<any> {
  const { data } = await ticketServiceClient.get(`/tickets/${ticketId}/status-history`);
  return data;
}

export async function getTicketEscalations(ticketId: string): Promise<any> {
  const { data } = await ticketServiceClient.get(`/tickets/${ticketId}/escalations`);
  return data;
}

/**
 * Start SLA tracking via POST /sla/start
 * Body: { ticketId, title, priority, ticketStatus, createdAt, assignedTo, requesterId, technician, supervisor }
 */
export async function startSlaTracking(
  ticketId: string,
  title: string,
  priority: string,
  ticketStatus: string,
  createdAt: string,
  assignedTo: string,
  requesterId: string,
  technician: { id: string; name: string; email: string },
  supervisor: { id: string; name: string; email: string },
): Promise<any> {
  const payload = {
    ticketId,
    title,
    priority,
    ticketStatus,
    createdAt,
    assignedTo,
    requesterId,
    technician,
    supervisor,
  };
  console.log(`[externalServices] POST ${SLA_SERVICE_URL}/sla/start | payload: ${JSON.stringify(payload)}`);
  const { data } = await slaServiceClient.post('/sla/start', payload);
  return data;
}

export async function getSlaStatusForTickets(
  ticketIds: string[],
  context?: ExternalCallContext,
): Promise<Record<string, any>> {
  const normalizedTicketIds = normalizeTicketIds(ticketIds);

  if (normalizedTicketIds.length === 0) {
    console.info('[externalServices] SLA bulk status skipped (empty ticket_ids)', {
      requestId: context?.requestId || null,
      caller: context?.caller || null,
    });
    return {};
  }

  try {
    const { data } = await slaServiceClient.post('/sla/tickets/status', {
      ticket_ids: normalizedTicketIds,
    });
    return data?.data || {};
  } catch (error: unknown) {
    console.error('[externalServices] SLA bulk status request failed', {
      requestId: context?.requestId || null,
      caller: context?.caller || null,
      ticketCount: normalizedTicketIds.length,
      ...toErrorMeta(error),
    });
    throw error;
  }
}

export async function getSlaComplianceReport(
  startDate?: string,
  endDate?: string,
): Promise<any> {
  const { data } = await slaServiceClient.get('/sla/reports/compliance', {
    params: {
      ...(startDate ? { start_date: startDate } : {}),
      ...(endDate ? { end_date: endDate } : {}),
    },
  });
  return data?.data;
}

export async function getSlaTicket(ticketId: string): Promise<any | null> {
  try {
    const { data } = await slaServiceClient.get(`/sla/tickets/${ticketId}`);
    return data?.data || null;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Get tickets assigned to specific users
 * Query: GET /tickets?assigned_to=userId1,userId2,...
 */
export async function getTicketsByAssignedUsers(userIds: number[]): Promise<any[]> {
  try {
    const normalizedUserIds = Array.from(
      new Set(
        userIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id)),
      ),
    );

    if (normalizedUserIds.length === 0) return [];

    const assignedUserSet = new Set(normalizedUserIds.map((id) => String(id)));

    // Request once, then filter locally by assigned_to. This avoids duplicate rows when
    // downstream services ignore assigned_to query params.
    const { data } = await ticketServiceClient.get('/tickets', {
      params: { assigned_to: normalizedUserIds.join(',') },
    });

    const rawTickets = Array.isArray(data) ? data : data?.tickets || [];
    const filteredTickets = rawTickets.filter((ticket: any) => {
      if (!ticket || ticket.assigned_to == null) return false;
      return assignedUserSet.has(String(ticket.assigned_to));
    });

    const dedupedById = new Map<string, any>();
    for (const ticket of filteredTickets) {
      const key = String(ticket.id);
      const existing = dedupedById.get(key);
      if (!existing) {
        dedupedById.set(key, ticket);
        continue;
      }

      const existingUpdated = new Date(existing.updated_at || existing.created_at || 0).getTime();
      const candidateUpdated = new Date(ticket.updated_at || ticket.created_at || 0).getTime();
      if (candidateUpdated >= existingUpdated) {
        dedupedById.set(key, ticket);
      }
    }

    return Array.from(dedupedById.values());
  } catch (error) {
    console.error('[externalServices] Error fetching tickets by assigned users:', error);
    return [];
  }
}
