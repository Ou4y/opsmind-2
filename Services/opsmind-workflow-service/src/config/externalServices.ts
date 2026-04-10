import axios, { AxiosInstance } from 'axios';
import { ExternalTicket, ExternalUser } from '../interfaces/types';

/**
 * External Service Clients (TypeScript)
 *
 * - Docker container names used as hostnames
 * - Typed responses for type-safety
 * - Timeout configuration prevents hanging requests
 */

const AUTH_SERVICE_URL: string = process.env.AUTH_SERVICE_URL || 'http://opsmind-auth-service:3002';
const TICKET_SERVICE_URL: string = process.env.TICKET_SERVICE_URL || 'http://opsmind-ticket-service:3000';

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

// ---------- Auth Service Helpers ----------

export async function validateUser(userId: number): Promise<ExternalUser> {
  const { data } = await authServiceClient.get<ExternalUser>(`/users/${userId}`);
  return data;
}

export async function getUserRole(userId: number): Promise<{ role: string }> {
  const { data } = await authServiceClient.get<{ role: string }>(`/users/${userId}/role`);
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
  };
  return map[role] || 'L1';
}

export async function getTicket(ticketId: string): Promise<ExternalTicket> {
  const { data } = await ticketServiceClient.get<ExternalTicket>(`/tickets/${ticketId}`);
  return data;
}

/**
 * Assign a ticket via PATCH /tickets/:id
 * Sends assigned_to (string), assigned_to_level (L1-L4), and status (IN_PROGRESS).
 */
export async function assignTicket(
  ticketId: string,
  userId: number | string,
  assignedToLevel: string = 'L1',
  status: string = 'IN_PROGRESS',
): Promise<any> {
  const { data } = await ticketServiceClient.patch(`/tickets/${ticketId}`, {
    assigned_to: String(userId),
    assigned_to_level: assignedToLevel,
    status,
  });
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
