const express = require("express");
const cors = require("cors");    
const notificationRoutes = require("./routes/notification.routes");
const errorMiddleware = require("./middlewares/error.middleware");

const app = express();


app.use(cors({
  origin: "http://localhost:8085", //frontend url 
  credentials: true
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Notification Service is running");
});

app.use("/api/notifications", notificationRoutes);

app.use(errorMiddleware);

module.exports = app;
