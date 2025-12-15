const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Services
const {
    removeBackgroundWithRemoveBg,
    removeBackgroundWithNanoBanana,
} = require("./services/background-remove");
const { optimizeCodeWithOpenAI } = require("./services/code-optimizer");
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

/* ======================
   AI / IMAGE
====================== */
app.post(
    "/image/remove-background",
    upload.single("image"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: "No image" });
            }

            const apiKey =
                req.get("x-api-key") ||
                process.env.NANO_BANANA_API_KEY ||
                process.env.REMOVE_BG_API_KEY;

            if (!apiKey) {
                return res
                    .status(500)
                    .json({ success: false, error: "API key missing" });
            }

            const src = path.join(uploadDir, req.file.filename);
            const outName = req.file.filename.replace(
                /(\.[\w]+)?$/,
                "-nobg.png"
            );
            const out = path.join(uploadDir, outName);

            const result = await removeBackgroundWithNanoBanana(src, apiKey);
            if (!result.success) {
                return res.status(502).json(result);
            }

            await fs.promises.writeFile(out, result.buffer);
            const base = `${req.protocol}://${req.get("host")}`;

            res.json({
                success: true,
                downloadUrl: `${base}/files/${encodeURIComponent(outName)}`,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
);

/* ======================
   AI CODE OPTIMIZER
====================== */
app.post("/ai/optimize-code", async (req, res) => {
    try {
        const result = await optimizeCodeWithOpenAI(req.body || {});
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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
