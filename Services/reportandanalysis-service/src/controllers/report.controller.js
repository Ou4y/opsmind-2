const Ticket = require("../models/ticket.model");
const { getResolvedTickets } = require("../services/ticket.service");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const { isSupportOrAdmin } = require("../middleware/auth");

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://auth-service:3002";
const INTERNAL_API_TOKEN = String(process.env.INTERNAL_API_TOKEN || "").trim();

function toOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function canAccessTicket(req, ticket) {
  if (req.auth?.type === "internal") {
    return true;
  }

  if (isSupportOrAdmin(req.auth?.roles || [])) {
    return true;
  }

  const userId = toOptionalString(req.auth?.userId);
  const assignedTo = toOptionalString(ticket?.assigned_to);
  return Boolean(userId && assignedTo && userId === assignedTo);
}

async function getTechnicianUUID(numericId) {
  try {
    const headers = INTERNAL_API_TOKEN ? { "x-internal-token": INTERNAL_API_TOKEN } : {};
    const res = await axios.get(`${AUTH_SERVICE_URL}/users/${numericId}`, { headers });
    return res.data.id;
  } catch (err) {
    console.error("Error fetching technician:", err.message);
    return numericId;
  }
}

exports.syncTickets = async (_req, res) => {
  try {
    const tickets = await getResolvedTickets();

    for (const t of tickets) {
      const exists = await Ticket.findOne({ id: t.id });

      if (!exists) {
        const technicianUUID = await getTechnicianUUID(t.assigned_to);

        await Ticket.create({
          id: t.id,
          title: t.title,
          description: t.description,
          type_of_request: t.resources?.type_of_request,
          requester_id: t.requester_id,
          latitude: t.location?.lat,
          longitude: t.location?.lng,
          assigned_to: technicianUUID,
          assigned_to_level: t.assigned_to_level,
          priority: t.priority,
          support_level: t.support_level,
          escalation_count: t.escalation_count,
          resolution_summary: t.resolution_summary,
          created_at: t.created_at,
          updated_at: t.updated_at,
          closed_at: t.closed_at,
          assigned_to_name: t.assigned_to_name,
        });
      }
    }

    res.json({
      message: "Synced successfully",
      count: tickets.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getMyTickets = async (req, res) => {
  try {
    const { technicianId } = req.params;
    const tickets = await Ticket.find({ assigned_to: technicianId });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch technician tickets" });
  }
};

exports.getAllReports = async (_req, res) => {
  try {
    const tickets = await Ticket.find({});
    res.json(tickets);
  } catch (_error) {
    res.status(500).json({ error: "Failed to fetch reports" });
  }
};

exports.addSolution = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { solution } = req.body;

    const ticket = await Ticket.findOne({ id: ticketId });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updatedTicket = await Ticket.findOneAndUpdate(
      { id: ticketId },
      { technician_solution: solution },
      { new: true }
    );

    return res.json(updatedTicket);
  } catch (_error) {
    return res.status(500).json({ error: "Failed to update ticket solution" });
  }
};

exports.generatePDF = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ id: ticketId });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (!canAccessTicket(req, ticket)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=report-${ticketId}.pdf`);

    doc.pipe(res);

    doc.fontSize(22).font("Helvetica-Bold").text("Ticket Report", { align: "center" });

    doc.moveDown(2);

    doc.fontSize(16).font("Helvetica-Bold").text("Ticket Details", { underline: true });

    doc.moveDown();

    const addField = (label, value) => {
      doc.font("Helvetica-Bold").fontSize(13).text(`${label}: `, { continued: true });
      doc.font("Helvetica").fontSize(12).text(value !== undefined && value !== null ? String(value) : "N/A");
      doc.moveDown();
    };

    addField("Ticket ID", ticket.id);
    addField("Title", ticket.title);
    addField("Description", ticket.description);
    addField("Priority", ticket.priority);
    addField("Technician ID", ticket.assigned_to);
    addField("Escalation Count", ticket.escalation_count);
    addField("Created At", ticket.created_at);

    doc.moveDown();

    doc.fontSize(16).font("Helvetica-Bold").text("Technician Solution", { underline: true });

    doc.moveDown();

    doc.font("Helvetica").fontSize(12).text(ticket.technician_solution || "No solution added");

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generating PDF" });
  }
};
