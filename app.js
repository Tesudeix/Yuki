const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

const { ensureAdminUser } = require("./services/admin-setup");
const { verifyToken } = require("./auth");
const {
  bytesFromMegabytes,
  createMinFreeSpaceGuard,
  createDiskUpload,
  getDiskInfo,
  parseAllowedMimeTypes,
  resolveUploadDir,
  toPositiveInt,
} = require("./lib/upload");

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
const uploadDir = resolveUploadDir(path.join(__dirname, "public", "uploads"));
const uploadMaxMb = toPositiveInt(process.env.UPLOAD_MAX_MB, 25);
const uploadMinFreeMb = toPositiveInt(process.env.UPLOAD_MIN_FREE_MB, 1024);
const uploadAllowedMimeTypes = parseAllowedMimeTypes(
  process.env.UPLOAD_ALLOWED_MIME_TYPES,
  [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.android.package-archive",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ],
);

const upload = createDiskUpload({
  destinationDir: uploadDir,
  maxFileSizeBytes: bytesFromMegabytes(uploadMaxMb, 25),
  allowedMimeTypes: uploadAllowedMimeTypes,
});
const ensureUploadDiskFree = createMinFreeSpaceGuard({
  targetPath: uploadDir,
  minFreeBytes: bytesFromMegabytes(uploadMinFreeMb, 1024),
});

app.use("/files", express.static(uploadDir));

/* ======================
   ROUTE MOUNTS
====================== */
app.use("/api/auth", userRoutes);
app.use("/api/users", userRoutes);
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
const handleUpload = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded" });
  }

  const base = `${req.protocol}://${req.get("host")}`;
  return res.status(201).json({
    success: true,
    downloadUrl: `${base}/files/${encodeURIComponent(req.file.filename)}`,
  });
};

const uploadAuthGuard = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const payload = verifyToken(token);
    if (!payload?.userId && !payload?.adminId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Unauthorized", details: err.message });
  }
};

app.post("/upload", uploadAuthGuard, ensureUploadDiskFree, upload.single("file"), handleUpload);
app.post("/api/upload", uploadAuthGuard, ensureUploadDiskFree, upload.single("file"), handleUpload);

/* ======================
   HEALTH
====================== */
app.get("/", (req, res) => {
  res.json({ message: "Yuki backend is running" });
});

app.get("/health", (req, res) => {
  const mem = process.memoryUsage();
  const disk = getDiskInfo(uploadDir);
  res.json({
    success: true,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    uploads: {
      dir: uploadDir,
      freeMb: disk ? Math.floor(disk.freeBytes / 1024 / 1024) : null,
      minFreeMb: uploadMinFreeMb,
      maxUploadMb: uploadMaxMb,
    },
  });
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
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error: `File too large. Max allowed is ${uploadMaxMb}MB.`,
      });
    }
    return res.status(400).json({ success: false, error: err.code });
  }

  if (err && err.code === "UNSUPPORTED_FILE_TYPE") {
    return res.status(415).json({ success: false, error: err.message });
  }

  return res.status(500).json({ success: false, error: err?.message || "Internal Server Error" });
});

/* ======================
   BOOTSTRAP
====================== */
const PORT = Number(process.env.PORT || 4000);
const MONGO_RETRY_DELAY_MS = toPositiveInt(process.env.MONGO_RETRY_DELAY_MS, 5000);

const buildMongoUri = () => {
  const explicit = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
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

let mongoConnectInFlight = false;
let reconnectTimer = null;
let server = null;

const scheduleReconnect = (reason) => {
  if (!MONGO_URI) return;
  if (mongoose.connection.readyState === 1) return;
  if (mongoConnectInFlight) return;
  if (reconnectTimer) return;

  console.warn(`Mongo reconnect scheduled in ${MONGO_RETRY_DELAY_MS}ms (${reason})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectMongo(`retry:${reason}`);
  }, MONGO_RETRY_DELAY_MS);
};

const connectMongo = async (reason = "startup") => {
  if (!MONGO_URI) {
    console.warn("MongoDB URI is not configured");
    return;
  }

  if (mongoConnectInFlight || mongoose.connection.readyState === 1) return;

  mongoConnectInFlight = true;
  try {
    if (reason === "startup") {
      console.log(`Mongo URI: ${maskMongoUri(MONGO_URI)}`);
    } else {
      console.log(`Mongo reconnect attempt (${reason})`);
    }

    await mongoose.connect(MONGO_URI, MONGO_CONNECT_OPTIONS);
    await ensureAdminUser();
  } catch (e) {
    console.error("Mongo connect failed:", e.message);
    console.error("Mongo connection config check:");
    console.error("  - Ensure MongoDB is running");
    console.error("  - Ensure username/password are correct");
    console.error("  - Ensure authSource=admin for Docker root user");
    console.error(`  - Tried URI: ${maskMongoUri(MONGO_URI)}`);
    scheduleReconnect(reason);
  } finally {
    mongoConnectInFlight = false;
  }
};

mongoose.connection.on("connected", () => {
  console.log(`Mongo connected (${mongoose.connection.name || "unknown-db"})`);
});

mongoose.connection.on("disconnected", () => {
  console.error("Mongo disconnected");
  scheduleReconnect("disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongo error:", err.message);
});

server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

void connectMongo();

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down`);
  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    await mongoose.connection.close(false);
  } catch (_) {
    // ignore close errors during shutdown
  }

  if (server) {
    server.close(() => process.exit(0));
    return;
  }

  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
