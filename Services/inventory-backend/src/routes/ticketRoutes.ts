import { Router, Request, Response } from 'express';
import TicketService from '../models/Tickets';
import { TicketStatus, TicketPriority, TicketType } from '@prisma/client';

const router = Router();

// Helper functions for enum mapping
function mapToTicketStatus(value: string): TicketStatus {
    const statusMap: Record<string, TicketStatus> = {
        'Open': 'OPEN',
        'In Progress': 'IN_PROGRESS',
        'Resolved': 'RESOLVED',
        'Closed': 'CLOSED'
    };
    return statusMap[value] || 'OPEN';
}

function mapToTicketPriority(value: string): TicketPriority {
    const priorityMap: Record<string, TicketPriority> = {
        'Low': 'LOW',
        'Medium': 'MEDIUM',
        'High': 'HIGH',
        'Critical': 'CRITICAL'
    };
    return priorityMap[value] || 'MEDIUM';
}

function mapToTicketType(value: string): TicketType {
    const typeMap: Record<string, TicketType> = {
        'Hardware': 'HARDWARE',
        'Software': 'SOFTWARE',
        'Network': 'NETWORK',
        'Access': 'ACCESS',
        'Other': 'OTHER'
    };
    return typeMap[value] || 'OTHER';
}

// GET all tickets
router.get('/', async (req: Request, res: Response) => {
    try {
        const tickets = await TicketService.getTickets();
        res.json(tickets);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// CREATE a new ticket
router.post('/', async (req: Request, res: Response) => {
    try {
        const { title, description, priority, type, relatedAsset, assignedTo } = req.body;

        const newTicket = await TicketService.createTicket({
            title,
            description,
            priority: mapToTicketPriority(priority || 'Medium'),
            type: mapToTicketType(type || 'Other'),
            relatedAsset,
            assignedTo,
            status: 'OPEN'
        });

        res.status(201).json(newTicket);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// UPDATE ticket status (e.g. dragging kanban board)
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const ticket = await TicketService.getTicketById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const updateData: any = {};
        if (req.body.status) updateData.status = mapToTicketStatus(req.body.status);
        if (req.body.assignedTo) updateData.assignedTo = req.body.assignedTo;

        const updatedTicket = await TicketService.updateTicket(req.params.id, updateData);
        res.json(updatedTicket);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE a ticket
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        await TicketService.deleteTicket(req.params.id);
        res.json({ message: 'Ticket deleted' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
