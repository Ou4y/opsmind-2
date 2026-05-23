const axios = require("axios");

const BASE_URL = process.env.TICKET_SERVICE_URL || "http://ticket-service:3000";

async function getResolvedTickets() {
  const res = await axios.get(`${BASE_URL}/tickets?status=RESOLVED`);
  return res.data;
}

module.exports = { getResolvedTickets };
