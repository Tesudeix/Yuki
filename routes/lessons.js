const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { verifyToken } = require("../auth");
const Lesson = require("../models/Lesson");
const {
  bytesFromMegabytes,
  createMinFreeSpaceGuard,
  createDiskUpload,
  parseAllowedMimeTypes,
  resolveUploadDir,
  toPositiveInt,
} = require("../lib/upload");

const router = express.Router();

const mongoStateLabels = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
const ensureMongo = (res) => {
  const state = mongoose.connection.readyState;
  if (state !== 1) {
    return res
      .status(503)
      .json({ success: false, error: "MongoDB connection unavailable", details: mongoStateLabels[state] || "unknown" });
  }
  return null;
};

const authGuard = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Unauthorized", details: err.message });
  }
};

const superAdmins = new Set([
  process.env.ADMIN_PHONE || process.env.SUPERADMIN_PHONE || "+97694641031",
]);

const adminOnly = (req, res, next) => {
  const phone = req.user?.phone || "";
  const role = req.user?.role || "";
  if (role === "admin" || superAdmins.has(phone)) return next();
  return res.status(403).json({ success: false, error: "Forbidden" });
};

const uploadDir = resolveUploadDir(path.join(__dirname, "..", "public", "uploads"));
const lessonFileMaxMb = toPositiveInt(process.env.LESSON_FILE_MAX_MB, 80);
const uploadMinFreeMb = toPositiveInt(process.env.UPLOAD_MIN_FREE_MB, 1024);
const upload = createDiskUpload({
  destinationDir: uploadDir,
  maxFileSizeBytes: bytesFromMegabytes(lessonFileMaxMb, 80),
  allowedMimeTypes: parseAllowedMimeTypes(
    process.env.LESSON_FILE_ALLOWED_MIME_TYPES,
    [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-matroska",
      "application/pdf",
      "application/octet-stream",
    ],
  ),
});
const ensureUploadDiskFree = createMinFreeSpaceGuard({
  targetPath: uploadDir,
  minFreeBytes: bytesFromMegabytes(uploadMinFreeMb, 1024),
});

const extractUploadFilenameFromUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value, "http://localhost");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length || parts[0] !== "files") return "";
    return path.basename(decodeURIComponent(parts[parts.length - 1] || ""));
  } catch (_) {
    return "";
  }
};

const deleteUploadedFile = (filename) => {
  const safe = path.basename(String(filename || "").trim());
  if (!safe) return;
  fs.unlink(path.join(uploadDir, safe), (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Failed to delete lesson upload:", err.message);
    }
  });
};

const updateLesson = async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;

  try {
    const fields = (({ title, url, description, folder }) => ({ title, url, description, folder }))(req.body || {});
    const updates = Object.fromEntries(
      Object.entries(fields).filter(([_, v]) => typeof v !== "undefined").map(([k, v]) => [k, String(v)])
    );

    const existing = await Lesson.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, error: "Lesson not found" });

    const doc = await Lesson.findByIdAndUpdate(req.params.id, updates, { new: true }).populate(
      "author",
      "_id name phone",
    );

    const oldFile = extractUploadFilenameFromUrl(existing.url);
    const nextFile = extractUploadFilenameFromUrl(updates.url);
    if (oldFile && oldFile !== nextFile) {
      deleteUploadedFile(oldFile);
    }

    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/lessons
router.get("/", async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const lessons = await Lesson.find({}).sort({ createdAt: -1 }).populate("author", "_id name phone").lean();
    return res.json(lessons);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/lessons (admin only)
router.post("/", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { title, url, description, folder } = req.body || {};
    if (!title || !url) return res.status(400).json({ success: false, error: "title and url are required" });
    const lesson = await Lesson.create({
      title: String(title),
      url: String(url),
      description: description ? String(description) : undefined,
      folder: folder ? String(folder) : undefined,
      author: req.user?.userId,
    });
    const populated = await Lesson.findById(lesson._id).populate("author", "_id name phone");
    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/lessons/upload (admin only)
router.post("/upload", authGuard, adminOnly, (req, res, next) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  return ensureUploadDiskFree(req, res, () => upload.single("file")(req, res, next));
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "file is required" });
    }

    const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const inferredTitle = path.basename(req.file.originalname || "Lesson", path.extname(req.file.originalname || ""));
    const title = titleRaw || inferredTitle || "Lesson";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const folder = typeof req.body?.folder === "string" ? req.body.folder.trim() : "";
    const base = `${req.protocol}://${req.get("host")}`;
    const url = `${base}/files/${encodeURIComponent(req.file.filename)}`;

    const lesson = await Lesson.create({
      title,
      url,
      description: description || undefined,
      folder: folder || undefined,
      author: req.user?.userId,
    });

    const populated = await Lesson.findById(lesson._id).populate("author", "_id name phone");
    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/lessons/:id (admin only)
router.put("/:id", authGuard, adminOnly, updateLesson);
router.patch("/:id", authGuard, adminOnly, updateLesson);

// DELETE /api/lessons/:id (admin only)
router.delete("/:id", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const doc = await Lesson.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Lesson not found" });
    const filename = extractUploadFilenameFromUrl(doc.url);
    if (filename) {
      deleteUploadedFile(filename);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
