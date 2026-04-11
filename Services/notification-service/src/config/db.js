const mongoose = require("mongoose");

const connectMongoDB = async () => {
  try {
    console.log(" MONGO_URI =", process.env.MONGO_URI);
    console.log(" Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Atlas connected");
  } catch (err) {
    console.error(" MongoDB connection failed:", err);
    process.exit(1);
  }
};

module.exports = connectMongoDB;
