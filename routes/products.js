const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductOrder = require("../models/ProductOrder");
const { verifyToken } = require("../auth");
const {
  bytesFromMegabytes,
  createMinFreeSpaceGuard,
  createDiskUpload,
  parseAllowedMimeTypes,
  resolveUploadDir,
  toPositiveInt,
} = require("../lib/upload");

const router = express.Router();

const uploadDir = resolveUploadDir(path.join(__dirname, "..", "public", "uploads"));
const productImageMaxMb = toPositiveInt(process.env.PRODUCT_IMAGE_MAX_MB, 8);
const uploadMinFreeMb = toPositiveInt(process.env.UPLOAD_MIN_FREE_MB, 1024);
const upload = createDiskUpload({
  destinationDir: uploadDir,
  maxFileSizeBytes: bytesFromMegabytes(productImageMaxMb, 8),
  allowedMimeTypes: parseAllowedMimeTypes(
    process.env.PRODUCT_IMAGE_ALLOWED_MIME_TYPES,
    ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  ),
});
const ensureUploadDiskFree = createMinFreeSpaceGuard({
  targetPath: uploadDir,
  minFreeBytes: bytesFromMegabytes(uploadMinFreeMb, 1024),
});

const deleteUploadedFile = (filename) => {
  const safe = path.basename(String(filename || "").trim());
  if (!safe) return;
  fs.unlink(path.join(uploadDir, safe), (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Failed to delete product upload:", err.message);
    }
  });
};

const maybeUploadImage = (req, res, next) => {
  if (req.is("multipart/form-data")) {
    return ensureUploadDiskFree(req, res, () => upload.single("image")(req, res, next));
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

const adminOnly = (req, res, next) => {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ success: false, error: "Forbidden" });
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
router.post("/", authGuard, adminOnly, maybeUploadImage, async (req, res) => {
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
router.delete("/:id", authGuard, adminOnly, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const item = await Product.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Not found" });
    if (item.image) {
      deleteUploadedFile(item.image);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
