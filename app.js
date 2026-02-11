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
const orderRoutes = require("./routes/orders");
const adminCargoRoutes = require("./routes/admin-cargo");

const app = express();
app.set("trust proxy", true);
const mongoStateLabels = ["disconnected", "connected", "connecting", "disconnecting"];

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
app.use("/api/orders", orderRoutes);
app.use("/api/admin/cargo", adminCargoRoutes);

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
            state: mongoStateLabels[s] || "unknown",
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
const toPositiveInt = (raw, fallback) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const buildMongoUri = () => {
    const explicit =
        (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (explicit) return explicit;

    const host = (process.env.MONGO_HOST || "127.0.0.1").trim();
    const port = toPositiveInt(process.env.MONGO_PORT, 27017);
    const db = (process.env.MONGO_DB || (process.env.NODE_ENV === "production" ? "yukiDB" : "yuki")).trim();

    const user = (process.env.MONGO_USER || "").trim();
    const password = (process.env.MONGO_PASSWORD || "").trim();
    const authSource = (process.env.MONGO_AUTH_SOURCE || "").trim();

    if (user && password) {
        const query = new URLSearchParams();
        query.set("authSource", authSource || "admin");
        return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}?${query.toString()}`;
    }

    // Production-safe fallback matching Docker setup in this project.
    if (process.env.NODE_ENV === "production") {
        return `mongodb://admin:tesu123@${host}:${port}/${db}?authSource=admin`;
    }

    return `mongodb://${host}:${port}/${db}`;
};

const maskMongoUri = (uri) => uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
const MONGO_URI = buildMongoUri();
const MONGO_CONNECT_OPTIONS = {
    autoIndex: process.env.NODE_ENV !== "production",
    serverSelectionTimeoutMS: toPositiveInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10000),
};

(async () => {
    try {
        mongoose.connection.on("connected", () => {
            console.log(`✅ Mongo connected (${mongoose.connection.name || "unknown-db"})`);
        });
        mongoose.connection.on("disconnected", () => {
            console.error("❌ Mongo disconnected");
        });
        mongoose.connection.on("error", (err) => {
            console.error("❌ Mongo error:", err.message);
        });

        if (MONGO_URI) {
            console.log(`ℹ️ Mongo URI: ${maskMongoUri(MONGO_URI)}`);
            await mongoose.connect(MONGO_URI, MONGO_CONNECT_OPTIONS);
            await ensureAdminUser();
        } else {
            console.warn("⚠️ MongoDB not configured");
        }

        app.listen(PORT, () =>
            console.log(`🚀 Server running on port ${PORT}`)
        );
    } catch (e) {
        console.error("Startup failed:", e.message);
        console.error("Mongo connection config check:");
        console.error("  - Ensure MongoDB is running");
        console.error("  - Ensure username/password are correct");
        console.error("  - Ensure authSource=admin for Docker root user");
        console.error(`  - Tried URI: ${maskMongoUri(MONGO_URI)}`);
        process.exit(1);
    }
})();
