import express from 'express';
import Ticket from '../models/Tickets';

const router = express.Router();

// GET all tickets
router.get('/', async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE a new ticket
router.post('/', async (req, res) => {
  const ticket = new Ticket({
    title: req.body.title,
    description: req.body.description,
    priority: req.body.priority,
    type: req.body.type,
    relatedAsset: req.body.relatedAsset,
    status: 'Open' // Default status
  });

  try {
    const newTicket = await ticket.save();
    res.status(201).json(newTicket);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// UPDATE ticket status (e.g. dragging kanban board)
router.patch('/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    if (req.body.status) ticket.status = req.body.status;
    if (req.body.assignedTo) ticket.assignedTo = req.body.assignedTo;

    const updatedTicket = await ticket.save();
    res.json(updatedTicket);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE a ticket
router.delete('/:id', async (req, res) => {
    try {
        await Ticket.findByIdAndDelete(req.params.id);
        res.json({ message: 'Ticket deleted' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;