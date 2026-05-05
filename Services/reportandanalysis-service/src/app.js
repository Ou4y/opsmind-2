const express = require("express");
const cors = require("cors");
const analyticsRoutes = require("./routes/analytics.routes");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/analytics", analyticsRoutes);

app.get("/health", (req, res) => {
  res.json({
    service: "Reporting & Analytics",
    status: "UP"
  });
});

module.exports = app;