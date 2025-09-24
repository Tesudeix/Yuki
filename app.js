const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const userRoutes = require("./routes/user");
const bookingRoutes = require("./routes/booking");
const adminRoutes = require("./routes/admin");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/users", userRoutes);
app.use("/booking", bookingRoutes);
app.use("/admin", adminRoutes);

// Test route
app.get("/", (req, res) => {
    res.json({ message: "🚀 Yuki backend is running with Twilio Verify!" });
});

const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);

const { ensureAdminUser } = require("./services/admin-setup");

const bootstrap = async () => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error("❌ MONGO_URI is not configured.");
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log("✅ MongoDB connected");
        await ensureAdminUser();
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Failed to start server", err);
        process.exit(1);
    }
};

bootstrap();
