const Ticket = require("../models/ticket.model");
const { getResolvedTickets } = require("../services/ticket.service");
const PDFDocument = require("pdfkit");
const axios = require("axios");

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://auth-service:3002";

//  function get UUID from auth 
async function getTechnicianUUID(numericId) {
  try {
    const res = await axios.get(
      `${AUTH_SERVICE_URL}/users/${numericId}`
    );

    return res.data.id;
  } catch (err) {
    console.error("Error fetching technician:", err.message);
    return numericId; 
  }
}

//  Sync tickets
exports.syncTickets = async (req, res) => {
  try {
    const tickets = await getResolvedTickets();

    for (let t of tickets) {
      const exists = await Ticket.findOne({ id: t.id });

      if (!exists) {
        const technicianUUID = await getTechnicianUUID(t.assigned_to);
        console.log("ESCALATION =", t.escalation_count);

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

// get all reports for admin
exports.getAllReports = async (req, res) => {
  const tickets = await Ticket.find({});

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


// check similar issue
exports.checkSimilarIssue = async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title && !description) {
      return res.status(400).json({
        found: false,
        message: "Title or description is required"
      });
    }

    const currentText =
      `${title || ""} ${description || ""}`
        .toLowerCase()
        .trim();

    const solvedTickets = await Ticket.find({
      technician_solution: {
        $exists: true,
        $ne: ""
      }
    });

    let bestMatch = null;
    let bestScore = 0;

    for (const ticket of solvedTickets) {

      const oldText =
        `${ticket.title || ""} ${ticket.description || ""}`
          .toLowerCase()
          .trim();

      const currentWords = currentText
        .split(/\s+/)
        .filter(Boolean);

      const oldWords = oldText
        .split(/\s+/)
        .filter(Boolean);

      const commonWords = currentWords.filter(
        word => oldWords.includes(word)
      );

      const score =
        currentWords.length > 0
          ? commonWords.length / currentWords.length
          : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = ticket;
      }
    }

    if (bestMatch && bestScore >= 0.4) {
      return res.json({
        found: true,
        similarityScore: bestScore,
        solution: bestMatch.technician_solution
      });
    }

    return res.json({
      found: false,
      message: "No similar tickets found"
    });

  } catch (error) {
    console.error("Similarity Search Error:", error);

    return res.status(500).json({
      found: false,
      message: "Internal Server Error"
    });
  }
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

    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("Ticket Report", { align: "center" });

    doc.moveDown(2);

    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("Ticket Details", { underline: true });

    doc.moveDown();

    const addField = (label, value) => {
      doc.font("Helvetica-Bold").fontSize(13).text(label + ": ", { continued: true });
      doc.font("Helvetica").fontSize(12).text(value !== undefined && value !== null
        ? String(value)
        : "N/A");
      doc.moveDown();
    };

    addField("Ticket ID", ticket.id);
    addField("Title", ticket.title);
    addField("Description", ticket.description);
    addField("Priority", ticket.priority);
    addField("Technician ID", ticket.assigned_to); // UUID
    addField("Escalation Count", ticket.escalation_count);
    addField("Created At", ticket.created_at);

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
