const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const userRoutes = require("./routes/user");


const app = express();
app.use(cors());
app.use(express.json());
app.use("/users", userRoutes);
// MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/yukiDB")
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// Test route
app.get("/", (req, res) => {
    res.json({ message: "🚀 Yuki backend is running!" });
});


const PORT = process.env.PORT || 4000;

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
