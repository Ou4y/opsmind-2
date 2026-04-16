const Ticket = require("../models/ticket.model");
const { getResolvedTickets } = require("../services/ticket.service");
const PDFDocument = require("pdfkit");

//  Sync tickets
exports.syncTickets = async (req, res) => {
  try {
    const tickets = await getResolvedTickets();

    for (let t of tickets) {
      const exists = await Ticket.findOne({ id: t.id });

      if (!exists) {
        await Ticket.create({
          id: t.id,
          title: t.title,
          description: t.description,
          type_of_request: t.resources?.type_of_request,
          requester_id: t.requester_id,
          latitude: t.location?.lat,
          longitude: t.location?.lng,
          assigned_to: t.assigned_to,
          assigned_to_level: t.assigned_to_level,
          priority: t.priority,
          support_level: t.support_level,
          escalation_count: t.escalation_count,
          resolution_summary: t.resolution_summary,
          created_at: t.created_at,
          updated_at: t.updated_at,
          closed_at: t.closed_at,
          assigned_to_name: t.assigned_to_name
        });
      }
    }

    res.json({
      message: "Synced successfully",
      count: tickets.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// get technician tickets
exports.getMyTickets = async (req, res) => {
  const { technicianId } = req.params;

  const tickets = await Ticket.find({ assigned_to: technicianId });

  res.json(tickets);
};

// add solution
exports.addSolution = async (req, res) => {
  const { ticketId } = req.params;
  const { solution } = req.body;

  const ticket = await Ticket.findOneAndUpdate(
    { id: ticketId },
    { technician_solution: solution },
    { new: true }
  );

  res.json(ticket);
};

// generate PDF
exports.generatePDF = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ id: ticketId });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=report-${ticketId}.pdf`
    );

    doc.pipe(res);

    //  Title
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("Ticket Report", { align: "center" });

    doc.moveDown(2);

    // Ticket Details Section
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("Ticket Details", { underline: true });

    doc.moveDown();

    //  Fields (Bold label + normal value)
    const addField = (label, value) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(label + ": ", { continued: true });

      doc
        .font("Helvetica")
        .fontSize(12)
        .text(value || "N/A");

      doc.moveDown();
    };

    addField("Ticket ID", ticket.id);
    addField("Title", ticket.title);
    addField("Description", ticket.description);
    addField("Priority", ticket.priority);
    addField("Technician ID", ticket.assigned_to);
    addField("Created At", ticket.created_at);

    //  Solution Section
    doc.moveDown();

    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("Technician Solution", { underline: true });

    doc.moveDown();

    doc
      .font("Helvetica")
      .fontSize(12)
      .text(ticket.technician_solution || "No solution added");

    doc.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generating PDF" });
  }
};