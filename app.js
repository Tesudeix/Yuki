const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const userRoutes = require("./routes/user");
const { checkVerifyService } = require("./twilio");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/users", userRoutes);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// Test route
app.get("/", (req, res) => {
    res.json({ message: "🚀 Yuki backend is running with Twilio Verify!" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);

    checkVerifyService({ force: true })
        .then((status) => {
            if (status.ok) {
                console.log(`✅ Twilio Verify service ready (${status.service.friendlyName || status.service.sid})`);
            } else {
                console.error("⚠️ Twilio Verify service check failed", status.error);
            }
        })
        .catch((error) => {
            console.error("❌ Unexpected Twilio Verify check error", error);
        });
});
