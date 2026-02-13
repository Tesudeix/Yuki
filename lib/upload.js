const fs = require("fs");
const path = require("path");
const multer = require("multer");

const toPositiveInt = (raw, fallback) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const bytesFromMegabytes = (rawMb, fallbackMb) => {
  const mb = toPositiveInt(rawMb, fallbackMb);
  return mb * 1024 * 1024;
};

const resolveUploadDir = (fallbackDir) => {
  const raw = String(process.env.UPLOAD_DIR || "").trim();
  if (!raw) return fallbackDir;
  return path.resolve(raw);
};

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

const parseAllowedMimeTypes = (raw, defaults = []) => {
  const source =
    typeof raw === "string" && raw.trim().length
      ? raw.split(",")
      : defaults;
  return source
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
};

const createDiskUpload = ({
  destinationDir,
  maxFileSizeBytes,
  allowedMimeTypes = [],
}) => {
  fs.mkdirSync(destinationDir, { recursive: true });
  const allowed = new Set(
    (allowedMimeTypes || []).map((v) => String(v).toLowerCase())
  );

  const fileFilter = (req, file, cb) => {
    if (!allowed.size) return cb(null, true);
    const mime = String(file?.mimetype || "").toLowerCase();
    if (allowed.has(mime)) return cb(null, true);
    const err = new Error(`Unsupported file type: ${mime || "unknown"}`);
    err.code = "UNSUPPORTED_FILE_TYPE";
    return cb(err);
  };

  return multer({
    storage: multer.diskStorage({
      destination: destinationDir,
      filename: (req, file, cb) => cb(null, makeUniqueFilename(file.originalname)),
    }),
    limits: maxFileSizeBytes ? { fileSize: maxFileSizeBytes } : undefined,
    fileFilter,
  });
};

const getDiskInfo = (targetPath) => {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    const info = fs.statfsSync(targetPath);
    const blockSize = Number(info.bsize || info.frsize || 0);
    const availableBlocks = Number(info.bavail || 0);
    const freeBytes = blockSize > 0 ? blockSize * availableBlocks : 0;
    return { freeBytes };
  } catch (_) {
    return null;
  }
};

const createMinFreeSpaceGuard = ({ targetPath, minFreeBytes }) => {
  return (req, res, next) => {
    if (!minFreeBytes || minFreeBytes <= 0) return next();
    const info = getDiskInfo(targetPath);
    if (!info) return next();
    if (info.freeBytes >= minFreeBytes) return next();
    return res.status(507).json({
      success: false,
      error: "Insufficient storage available on server",
      details: {
        requiredFreeBytes: minFreeBytes,
        availableFreeBytes: info.freeBytes,
      },
    });
  };
};

module.exports = {
  bytesFromMegabytes,
  createMinFreeSpaceGuard,
  createDiskUpload,
  getDiskInfo,
  makeUniqueFilename,
  parseAllowedMimeTypes,
  resolveUploadDir,
  sanitizeName,
  toPositiveInt,
};
