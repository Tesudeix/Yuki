const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Services
const { ensureAdminUser } = require("./services/admin-setup");

// Routes
const userRoutes = require("./routes/user");
const bookingRoutes = require("./routes/booking");
const adminRoutes = require("./routes/admin");
const postRoutes = require("./routes/posts");
const lessonsRoutes = require("./routes/lessons");
const productsRoutes = require("./routes/products");

const app = express();
app.set("trust proxy", true);

/* ======================
   MIDDLEWARE
====================== */
app.use(cors({ origin: true, credentials: true }));
app.options(/.*/, cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));

/* ======================
   UPLOAD SETUP
====================== */
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use("/files", express.static(uploadDir));

const sanitizeName = (v) =>
    String(v || "")
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^[-_.]+|[-_.]+$/g, "");

const makeUniqueFilename = (name) => {
    const base = path.basename(name || "file");
    const ext = path.extname(base);
    const n = sanitizeName(base.replace(ext, "")) || "file";
    return `${n}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}${ext}`;
};

const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) =>
            cb(null, makeUniqueFilename(file.originalname)),
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
});

/* ======================
   ROUTE MOUNTS (FIXED)
====================== */
app.use("/api/auth", userRoutes);   // 🔐 register/login/profile
app.use("/api/users", userRoutes);  // 👤 admin & users
app.use("/api/booking", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/products", productsRoutes);

/* ======================
   UPLOAD
====================== */
app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    const base = `${req.protocol}://${req.get("host")}`;
    res.status(201).json({
        success: true,
        downloadUrl: `${base}/files/${encodeURIComponent(req.file.filename)}`,
    });
});

/* Background removal endpoint removed intentionally */
/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
    res.json({ message: "🚀 Yuki backend is running with Twilio Verify!" });
});

app.get("/health", (req, res) => {
    res.json({ success: true, pid: process.pid });
});

app.get("/health/mongo", (req, res) => {
    const s = mongoose.connection.readyState;
    res.json({
        success: true,
        mongo: {
            connected: s === 1,
            state: ["disconnected", "connected", "connecting", "disconnecting"][s],
            db: mongoose.connection.name || null,
        },
    });
});

/* ======================
   ERROR HANDLER
====================== */
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, error: err.code });
    }
    res.status(500).json({ success: false, error: err.message });
});

/* ======================
   BOOTSTRAP
====================== */
const PORT = Number(process.env.PORT || 4000);
const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGODB_URL;

(async () => {
    try {
        if (MONGO_URI) {
            await mongoose.connect(MONGO_URI);
            await ensureAdminUser();
            console.log("✅ MongoDB connected");
        } else {
            console.warn("⚠️ MongoDB not configured");
        }

        app.listen(PORT, () =>
            console.log(`🚀 Server running on port ${PORT}`)
        );
    } catch (e) {
        console.error("Startup failed:", e);
        process.exit(1);
    }
})();
