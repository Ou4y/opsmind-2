const express = require("express");
const router = express.Router();
const controller = require("../controllers/report.controller");

router.get("/sync", controller.syncTickets);
router.get("/technician/:technicianId", controller.getMyTickets);
router.get("/report/:ticketId", controller.generatePDF);
router.post("/solution/:ticketId", controller.addSolution);

module.exports = router;