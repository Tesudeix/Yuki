const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const { verifyToken } = require("../auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, makeUniqueFilename(file.originalname)),
});
const upload = multer({ storage });

const mongoStateLabels = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
const ensureMongo = (res) => {
  const state = mongoose.connection.readyState;
  if (state !== 1) {
    return res.status(503).json({ success: false, error: "MongoDB connection unavailable", details: mongoStateLabels[state] || "unknown" });
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
  if (superAdmins.has(phone)) return next();
  return res.status(403).json({ success: false, error: "Forbidden" });
};

// Allowed categories for validation and filtering
const ALLOWED_CATEGORIES = new Set(["Prompt", "Design", "Clothes"]);

// GET /api/products
router.get("/", async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { category } = req.query || {};
    const filter = {};
    if (category && typeof category === "string" && ALLOWED_CATEGORIES.has(category)) {
      filter.category = category;
    }
    const items = await Product.find(filter).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products (superadmin)
router.post("/", authGuard, adminOnly, upload.single("image"), async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { name, price, description, category } = req.body || {};
    if (!name || !price || !category) return res.status(400).json({ success: false, error: "name, price and category are required" });
    if (!ALLOWED_CATEGORIES.has(String(category))) return res.status(400).json({ success: false, error: "Invalid category" });
    const item = await Product.create({
      name: String(name),
      price: Number(price),
      category: String(category),
      description: description ? String(description) : undefined,
      image: req.file ? req.file.filename : undefined,
    });
    return res.status(201).json({ product: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/products/:id (superadmin)
router.delete("/:id", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const item = await Product.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
