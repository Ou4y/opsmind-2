const axios = require("axios");

const BASE_URL = process.env.TICKET_SERVICE_URL || "http://ticket-service:3000";
const INTERNAL_API_TOKEN = String(process.env.INTERNAL_API_TOKEN || "").trim();

async function getResolvedTickets() {
  const headers = {};
  if (INTERNAL_API_TOKEN) {
    headers["x-internal-token"] = INTERNAL_API_TOKEN;
  }

  const res = await axios.get(`${BASE_URL}/tickets?status=RESOLVED`, { headers });
  return res.data;
}

module.exports = { getResolvedTickets };
