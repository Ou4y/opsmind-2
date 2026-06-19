const express = require("express");
const router = express.Router();
const controller = require("../controllers/report.controller");
const {
  requireInternalToken,
  requireAuthOrInternal,
  requireSupportRole,
  requireSelfOrSupport,
} = require("../middleware/auth");

router.get("/sync", requireInternalToken, controller.syncTickets);
router.get("/admin/reports", requireAuthOrInternal, requireSupportRole, controller.getAllReports);
router.get("/technician/:technicianId", requireAuthOrInternal, requireSelfOrSupport("technicianId"), controller.getMyTickets);
router.get("/report/:ticketId", requireAuthOrInternal, controller.generatePDF);
router.post("/solution/:ticketId", requireAuthOrInternal, controller.addSolution);

module.exports = router;
