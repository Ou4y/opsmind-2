import { Ticket } from "@prisma/client";
import { fetchTechnicianName, fetchTechnicianNames } from "./userServiceClient";

/**
 * Extended ticket response that includes the assigned technician's name.
 * This maintains backward compatibility by keeping all original fields.
 */
export interface EnrichedTicket extends Ticket {
  assigned_to_name: string | null;
}

/**
 * Enrich a single ticket with the assigned technician's name.
 * If assigned_to is null or name lookup fails, assigned_to_name will be null.
 */
export async function enrichTicketWithTechnicianName(
  ticket: Ticket
): Promise<EnrichedTicket> {
  if (!ticket.assigned_to) {
    return {
      ...ticket,
      assigned_to_name: null,
    };
  }

  const name = await fetchTechnicianName(ticket.assigned_to);

  return {
    ...ticket,
    assigned_to_name: name,
  };
}

/**
 * Enrich multiple tickets with assigned technician names.
 * Uses batch fetching for efficiency.
 */
export async function enrichTicketsWithTechnicianNames(
  tickets: Ticket[]
): Promise<EnrichedTicket[]> {
  if (tickets.length === 0) {
    return [];
  }

  // Collect all unique assigned_to IDs
  const technicianIds = tickets
    .map((t) => t.assigned_to)
    .filter((id): id is string => id !== null);

  // Batch fetch names
  const nameMap = await fetchTechnicianNames(technicianIds);

  // Enrich tickets
  return tickets.map((ticket) => ({
    ...ticket,
    assigned_to_name: ticket.assigned_to ? nameMap.get(ticket.assigned_to) ?? null : null,
  }));
}
