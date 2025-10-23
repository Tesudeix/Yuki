const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const userRoutes = require("./routes/user");
const bookingRoutes = require("./routes/booking");
const adminRoutes = require("./routes/admin");

const app = express();
// When behind reverse proxies (Nginx/Cloudflare), trust the forwarded headers
app.set("trust proxy", true);

// Middleware
app.use(cors());
// Explicitly allow preflight for safety in varied proxy setups
app.options("*", cors());
app.use(express.json());

// Ensure public/uploads directory exists for serving files
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

// Static file serving at /files/* for anything under public/uploads
app.use("/files", express.static(uploadDir));

// Helpers for safe, unique filenames
const sanitizeName = (input) =>
    String(input || "")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^[-_.]+|[-_.]+$/g, "");

const makeUniqueFilename = (originalName) => {
    const base = path.basename(originalName || "file");
    const extOrig = path.extname(base);
    const nameOrig = base.slice(0, base.length - extOrig.length);

    const nameSafe = sanitizeName(nameOrig) || "file";
    const extSafe = sanitizeName(extOrig.replace(/^\./, ""));
    const extPart = extSafe ? `.${extSafe}` : "";

    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${nameSafe}-${ts}-${rand}${extPart}`;
};

// Configure Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, makeUniqueFilename(file.originalname));
    },
});
const upload = multer({
    storage,
    limits: {
        // Cap file size to 200MB to mitigate abuse
        fileSize: 200 * 1024 * 1024,
    },
});

// Routes
app.use("/users", userRoutes);
app.use("/booking", bookingRoutes);
app.use("/admin", adminRoutes);

// Open upload endpoint (multipart/form-data)
app.post("/upload", upload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }
        const filename = req.file.filename;
        // Prefer a configured public base URL if provided
        const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
        const host = req.get("host");
        const protocol = req.protocol;
        const base = publicBase || `${protocol}://${host}`;
        const downloadUrl = `${base}/files/${encodeURIComponent(filename)}`;
        return res.status(201).json({ success: true, downloadUrl });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Upload failed", details: err?.message });
    }
});

// Test route
app.get("/", (req, res) => {
    res.json({ message: "🚀 Yuki backend is running with Twilio Verify!" });
});

// Centralized error handler (catches Multer and other middleware errors)
// Ensures malformed multipart requests don't crash the process
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, error: "Upload error", code: err.code });
    }
    return res.status(500).json({ success: false, error: "Server error", details: err?.message });
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
