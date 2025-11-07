const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
// Node 18+ provides global fetch/FormData/Blob via undici
const { removeBackgroundWithRemoveBg, removeBackgroundWithNanoBanana } = require("./services/background-remove");
const { optimizeCodeWithOpenAI } = require("./services/code-optimizer");

const userRoutes = require("./routes/user");
const bookingRoutes = require("./routes/booking");
const adminRoutes = require("./routes/admin");
const postRoutes = require("./routes/posts");
const lessonsRoutes = require("./routes/lessons");
const productsRoutes = require("./routes/products");

const app = express();
// When behind reverse proxies (Nginx/Cloudflare), trust the forwarded headers
app.set("trust proxy", true);

// Middleware
app.use(cors());
// Explicitly allow preflight for safety in varied proxy setups (Express 5 + path-to-regexp v6)
// Use a RegExp instead of '*' which is no longer supported
app.options(/.*/, cors());
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
app.use("/api/posts", postRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/products", productsRoutes);

// Open upload endpoint (multipart/form-data)
// In Yuki/app.js
app.post("/upload", upload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }
        const filename = req.file.filename;
        // Validate PUBLIC_BASE_URL; if invalid, use current request host
        let base = "";
        const rawBase = process.env.PUBLIC_BASE_URL || "";
        try {
            // Will throw if rawBase isn’t a valid absolute URL
            const urlObj = new URL(rawBase);
            base = `${urlObj.protocol}//${urlObj.host}`;
        } catch (e) {
            base = `${req.protocol}://${req.get("host")}`;
        }
        // Always return a full URL for the API and a relative path for the UI
        const downloadUrl = `${base}/files/${encodeURIComponent(filename)}`;
        return res.status(201).json({ success: true, downloadUrl });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: "Upload failed",
            details: err?.message,
        });
    }
});

// Background removal endpoint (multipart/form-data; field name: "image")
app.post("/image/remove-background", upload.single("image"), async (req, res) => {
    try {
        console.log("[remove-bg] incoming", { provider: req.body?.provider, hasFile: !!req.file, name: req.file?.originalname });
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No image uploaded" });
        }

        const rawKeyBody = (req.body && (req.body.apiKey || req.body.key || req.body.token)) || "";
        const rawKeyHeader = req.get("x-api-key") || req.get("authorization") || "";
        const apiKeyFromBody = String(rawKeyBody).replace(/^Bearer\s+/i, "").trim();
        const apiKeyFromHeader = String(rawKeyHeader).replace(/^Bearer\s+/i, "").trim();
        const apiKey = apiKeyFromBody || apiKeyFromHeader || process.env.NANO_BANANA_API_KEY || process.env.REMOVE_BG_API_KEY
            || process.env.BG_REMOVE_API_KEY
            || process.env.REMOVER_API_KEY
            || process.env.NANO_BANANO_API_KEY
            || process.env.NANO_BANANO_API
            || process.env.BACKGROUND_API_KEY;

        if (!apiKey) {
            console.warn("[remove-bg] missing API key");
            return res.status(500).json({ success: false, error: "Background API key is not configured" });
        }

        const srcPath = path.join(uploadDir, req.file.filename);
        const outName = req.file.filename.replace(/(\.[a-zA-Z0-9]+)?$/, (m) => m ? `-nobg${m}` : "-nobg.png");
        const outPath = path.join(uploadDir, outName);

        // Provider selection defaults to Nano Banana (OpenAI disabled)
        const provider = (req.body && req.body.provider) || "nanobanana";
        let result;
        if (provider === "removebg") {
            result = await removeBackgroundWithRemoveBg(srcPath, apiKey);
        } else if (provider === "nanobanana" || provider === "nano-banana" || provider === "nano") {
            const nbUrl = (req.body && (req.body.nbUrl || req.body.endpoint)) || process.env.NANO_BANANA_ENDPOINT || process.env.NANO_BANANA_API_URL;
            const product = (req.body && (req.body.product || req.body.subject)) || "kettle";
            const defaultPrompt = `Extract product A professional e-commerce product photograph of [${product}] displayed using the ghost mannequin technique. The outfit is perfectly centered, high-resolution, and isolated against a pure white, seamless studio background (#FFFFFF). The image features bright, even lighting, sharp, clean edges, and no human model or body parts. Format: 1:1 square aspect ratio.`;
            result = await removeBackgroundWithNanoBanana(srcPath, apiKey, nbUrl, defaultPrompt);
        } else if (provider === "openai") {
            return res.status(403).json({ success: false, error: "OpenAI provider is disabled. Use provider=nanobanana and supply Nano Banana API settings." });
        } else {
            // Placeholder for alternative provider integration
            return res.status(501).json({ success: false, error: `Provider '${provider}' is not supported yet.` });
        }
        if (!result.success) {
            console.warn("[remove-bg] provider error", result.error);
            return res.status(502).json({ success: false, error: result.error || "Background removal failed" });
        }

        await fs.promises.writeFile(outPath, result.buffer);

        let base = "";
        const rawBase = process.env.PUBLIC_BASE_URL || "";
        try {
            const urlObj = new URL(rawBase);
            base = `${urlObj.protocol}//${urlObj.host}`;
        } catch (e) {
            base = `${req.protocol}://${req.get("host")}`;
        }

        const downloadUrl = `${base}/files/${encodeURIComponent(outName)}`;
        console.log("[remove-bg] success", downloadUrl);
        return res.status(200).json({ success: true, downloadUrl, file: `/files/${encodeURIComponent(outName)}` });
    } catch (err) {
        console.error("[remove-bg] unhandled error", err);
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
    }
});

// Dedicated extract-product agent, defaults to Nano Banana and white background prompt
// POST /ai/extract-product (multipart/form-data) fields: image, product?, apiKey?, nbUrl?
app.post("/ai/extract-product", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No image uploaded" });
        }
        const rawKeyBody = (req.body && (req.body.apiKey || req.body.key || req.body.token)) || "";
        const rawKeyHeader = req.get("x-api-key") || req.get("authorization") || "";
        const apiKeyFromBody = String(rawKeyBody).replace(/^Bearer\s+/i, "").trim();
        const apiKeyFromHeader = String(rawKeyHeader).replace(/^Bearer\s+/i, "").trim();
        const apiKey = apiKeyFromBody || apiKeyFromHeader || process.env.NANO_BANANA_API_KEY || "";
        if (!apiKey) {
            return res.status(500).json({ success: false, error: "Nano Banana API key is not configured" });
        }
        const srcPath = path.join(uploadDir, req.file.filename);
        const outName = req.file.filename.replace(/(\.[a-zA-Z0-9]+)?$/, (m) => m ? `-product${m}` : "-product.png");
        const outPath = path.join(uploadDir, outName);

        const product = (req.body && (req.body.product || req.body.subject)) || "kettle";
        const defaultPrompt = `Extract product A professional e-commerce product photograph of [${product}] displayed using the ghost mannequin technique. The outfit is perfectly centered, high-resolution, and isolated against a pure white, seamless studio background (#FFFFFF). The image features bright, even lighting, sharp, clean edges, and no human model or body parts. Format: 1:1 square aspect ratio.`;
        const nbUrl = (req.body && (req.body.nbUrl || req.body.endpoint)) || process.env.NANO_BANANA_ENDPOINT || process.env.NANO_BANANA_API_URL;
        const result = await removeBackgroundWithNanoBanana(srcPath, apiKey, nbUrl, defaultPrompt);
        if (!result.success) {
            return res.status(502).json({ success: false, error: result.error || "Extraction failed" });
        }
        await fs.promises.writeFile(outPath, result.buffer);
        let base = "";
        const rawBase = process.env.PUBLIC_BASE_URL || "";
        try { const u = new URL(rawBase); base = `${u.protocol}//${u.host}`; } catch { base = `${req.protocol}://${req.get("host")}`; }
        const downloadUrl = `${base}/files/${encodeURIComponent(outName)}`;
        return res.json({ success: true, downloadUrl, file: `/files/${encodeURIComponent(outName)}` });
    } catch (err) {
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
    }
});

// Code optimizer agent (JSON)
// POST /ai/optimize-code
// Body: { code: string, language?: string, goals?: string, apiKey?: string, model?: string }
app.post("/ai/optimize-code", async (req, res) => {
    try {
        const { code, language, goals, model } = req.body || {};
        const rawKeyBody = (req.body && (req.body.apiKey || req.body.key || req.body.token)) || "";
        const rawKeyHeader = req.get("x-api-key") || req.get("authorization") || "";
        const apiKeyFromBody = String(rawKeyBody).replace(/^Bearer\s+/i, "").trim();
        const apiKeyFromHeader = String(rawKeyHeader).replace(/^Bearer\s+/i, "").trim();
        const apiKey = apiKeyFromBody || apiKeyFromHeader || process.env.OPENAI_API_KEY || "";

        const result = await optimizeCodeWithOpenAI({ apiKey, code, language, goals, model });
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
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
    // Support multiple common env var names for convenience
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_URL;
    let dbReady = false;
    if (!mongoUri) {
        console.warn("⚠️  MONGO_URI not set. Starting without DB.");
    } else {
        try {
            await mongoose.connect(mongoUri);
            console.log("✅ MongoDB connected");
            await ensureAdminUser();
            dbReady = true;
        } catch (err) {
            console.warn("⚠️  MongoDB connection failed — continuing without DB:", err?.message);
            console.warn("   Make sure your connection string uses mongodb:// or mongodb+srv:// and is properly URL-encoded.");
            console.warn("   Example (local): mongodb://127.0.0.1:27017/tesudeix");
            console.warn("   Example (Atlas): mongodb+srv://user:pass@cluster.x.mongodb.net/tesudeix?retryWrites=true&w=majority&appName=Cluster");
        }
    }
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}${dbReady ? " (DB connected)" : " (no DB)"}`);
    });
};

bootstrap();
