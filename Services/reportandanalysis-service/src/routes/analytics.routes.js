const express = require("express");
const router = express.Router();
const controller = require("../controllers/report.controller");
const {
  requireInternalToken,
  requireAuthOrInternal,
  requireSupportRole,
  requireSelfOrSupport,
} = require("../middleware/auth");

router.get("/sync", controller.syncTickets);
router.get("/admin/reports", controller.getAllReports);
router.get("/technician/:technicianId", controller.getMyTickets);
router.get("/report/:ticketId", controller.generatePDF);
router.post("/solution/:ticketId", controller.addSolution);
router.post("/check-similar-issue",controller.checkSimilarIssue);

module.exports = router;
