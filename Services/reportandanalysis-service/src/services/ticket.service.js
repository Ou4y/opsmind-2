const axios = require("axios");

const BASE_URL = "http://host.docker.internal:3001";

async function getResolvedTickets() {
  const res = await axios.get(`${BASE_URL}/tickets?status=RESOLVED`);
  return res.data;
}

module.exports = { getResolvedTickets };