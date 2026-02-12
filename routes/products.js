const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductOrder = require("../models/ProductOrder");

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

const maybeUploadImage = (req, res, next) => {
  if (req.is("multipart/form-data")) {
    return upload.single("image")(req, res, next);
  }
  return next();
};

const mongoStateLabels = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
const ensureMongo = (res) => {
  const state = mongoose.connection.readyState;
  if (state !== 1) {
    return res.status(503).json({ success: false, error: "MongoDB connection unavailable", details: mongoStateLabels[state] || "unknown" });
  }
  return null;
};

const extractImageFilename = (value) => {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const parsed = new URL(raw);
      const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
      const decoded = decodeURIComponent(last);
      return path.basename(decoded);
    }
  } catch (_) {
    return undefined;
  }

  return path.basename(raw);
};

// Allowed categories for validation and filtering
const ALLOWED_CATEGORIES = new Set([
  "Хоол",
  "Хүнс",
  "Бөөнний түгээлт",
  "Урьдчилсан захиалга",
  "Кофе амттан",
  "Алкохол",
  "Гэр ахуй & хүүхэд",
  "Эргэнэтэд үйлдвэрлэв",
  "Бэлэг & гоо сайхан",
  "Гадаад захиалга",
]);

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

// GET /api/products/:id
router.get("/:id", async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid product id" });
    }

    const item = await Product.findById(id).lean();
    if (!item) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    return res.json({ success: true, product: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products (public)
router.post("/", maybeUploadImage, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { name, price, description, category } = req.body || {};
    if (!name || !price || !category) {
      return res
        .status(400)
        .json({ success: false, error: "name, price and category are required" });
    }
    if (!ALLOWED_CATEGORIES.has(String(category))) return res.status(400).json({ success: false, error: "Invalid category" });
    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ success: false, error: "Invalid price" });
    }
    const imageFromBody = extractImageFilename(req.body?.image);
    const item = await Product.create({
      name: String(name).trim(),
      price: parsedPrice,
      category: String(category),
      description: description ? String(description).trim() : undefined,
      image: req.file ? req.file.filename : imageFromBody,
    });
    return res.status(201).json({ success: true, product: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/:id/order (public)
router.post("/:id/order", async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid product id" });
    }

    const product = await Product.findById(id).select("_id name");
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const customerName = String(req.body?.customerName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const note = String(req.body?.note || "").trim();
    const quantityInput = Number(req.body?.quantity || 1);
    const quantity = Number.isFinite(quantityInput) ? Math.max(1, Math.floor(quantityInput)) : 1;

    if (!customerName || !phone) {
      return res
        .status(400)
        .json({ success: false, error: "customerName and phone are required" });
    }

    const order = await ProductOrder.create({
      productId: product._id,
      productName: product.name,
      customerName,
      phone,
      quantity,
      note,
      status: "NEW",
    });

    return res.status(201).json({ success: true, order });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/products/:id (public)
router.delete("/:id", async (req, res) => {
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
