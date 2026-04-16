const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  id: String,
  title: String,
  description: String,
  type_of_request: String,
  requester_id: String,
  latitude: Number,
  longitude: Number,
  assigned_to: String,
  assigned_to_level: String,
  priority: String,
  support_level: String,
  escalation_count: Number,
  resolution_summary: String,
  technician_solution: String,
  created_at: Date,
  updated_at: Date,
  closed_at: Date,
  assigned_to_name: String
}, {
  collection: "solved-tickets"
});

module.exports = mongoose.model("Ticket", ticketSchema);