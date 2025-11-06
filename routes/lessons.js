const express = require("express");
const mongoose = require("mongoose");
const { verifyToken } = require("../auth");
const Lesson = require("../models/Lesson");

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

// PUT /api/lessons/:id (admin only)
router.put("/:id", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const fields = (({ title, url, description, folder }) => ({ title, url, description, folder }))(req.body || {});
    const updates = Object.fromEntries(
      Object.entries(fields).filter(([_, v]) => typeof v !== "undefined").map(([k, v]) => [k, String(v)])
    );
    const doc = await Lesson.findByIdAndUpdate(req.params.id, updates, { new: true }).populate(
      "author",
      "_id name phone",
    );
    if (!doc) return res.status(404).json({ success: false, error: "Lesson not found" });
    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/lessons/:id (admin only)
router.delete("/:id", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const doc = await Lesson.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Lesson not found" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

