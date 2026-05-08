import { prisma } from '../lib/prisma';
import { Ticket, TicketStatus, TicketPriority, TicketType } from '@prisma/client';

export interface ITicket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  assignedTo?: string;
  relatedAsset?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Ticket service functions
export class TicketService {
  // Create a new ticket
  static async createTicket(data: {
    title: string;
    description: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    type?: TicketType;
    assignedTo?: string;
    relatedAsset?: string;
  }): Promise<Ticket> {
    return await prisma.ticket.create({
      data: {
        title: data.title,
        description: data.description,
        status: data.status || 'OPEN',
        priority: data.priority || 'MEDIUM',
        type: data.type || 'OTHER',
        assignedTo: data.assignedTo,
        relatedAsset: data.relatedAsset,
      },
    });
  }

  // Get ticket by ID
  static async getTicketById(id: string): Promise<Ticket | null> {
    return await prisma.ticket.findUnique({
      where: { id },
    });
  }

  // Get all tickets with optional filters
  static async getTickets(filters?: {
    status?: TicketStatus;
    priority?: TicketPriority;
    type?: TicketType;
    assignedTo?: string;
    relatedAsset?: string;
  }): Promise<Ticket[]> {
    return await prisma.ticket.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Update ticket
  static async updateTicket(id: string, data: Partial<{
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    type: TicketType;
    assignedTo: string;
    relatedAsset: string;
  }>): Promise<Ticket> {
    return await prisma.ticket.update({
      where: { id },
      data,
    });
  }

  // Delete ticket
  static async deleteTicket(id: string): Promise<Ticket> {
    return await prisma.ticket.delete({
      where: { id },
    });
  }

  // Get tickets for a specific asset
  static async getTicketsForAsset(assetCustomId: string): Promise<Ticket[]> {
    return await prisma.ticket.findMany({
      where: { relatedAsset: assetCustomId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

// Export the service class as default
export default TicketService;
