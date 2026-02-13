const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Post = require("../models/Post");
const User = require("../models/User");
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
const postImageMaxMb = toPositiveInt(process.env.POST_IMAGE_MAX_MB, 8);
const uploadMinFreeMb = toPositiveInt(process.env.UPLOAD_MIN_FREE_MB, 1024);
const upload = createDiskUpload({
  destinationDir: uploadDir,
  maxFileSizeBytes: bytesFromMegabytes(postImageMaxMb, 8),
  allowedMimeTypes: parseAllowedMimeTypes(
    process.env.POST_IMAGE_ALLOWED_MIME_TYPES,
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
      console.error("Failed to delete post upload:", err.message);
    }
  });
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

const CATEGORIES = new Set(["General", "News", "Tools", "Tasks", "Antaqor", "Community"]);

const isMembershipActive = (user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.classroomAccess) return true;
  if (!user.membershipExpiresAt) return false;
  const expiry = new Date(user.membershipExpiresAt).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
};

// GET /api/posts?page=1&limit=10&category=News
router.get("/", async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const rawLimit = parseInt(req.query.limit || "10", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 20);
    const skip = (page - 1) * limit;
    const rawCat = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const category = CATEGORIES.has(rawCat) ? rawCat : null;

    let authPayload = null;
    let authUser = null;
    let membershipActive = false;
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        authPayload = verifyToken(token);
        if (authPayload?.userId) {
          authUser = await User.findById(authPayload.userId).lean();
          membershipActive = isMembershipActive(authUser);
        }
      } catch (_) {
        authPayload = null;
      }
    }

    if (category === "Community") {
      if (!token || !authPayload?.userId) {
        return res.status(401).json({ success: false, error: "Membership required" });
      }
      if (!membershipActive) {
        return res.status(403).json({ success: false, error: "Membership inactive" });
      }
    }

    let filter = {};
    if (category) {
      filter = { category };
    } else if (!membershipActive) {
      filter = { category: { $ne: "Community" } };
    }

    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "_id name phone avatarUrl")
      .populate({
        path: "comments.user",
        select: "_id name phone avatarUrl",
      })
      .populate({ path: "comments.replies.user", select: "_id name phone avatarUrl" })
      .populate({ path: "sharedFrom", populate: { path: "user", select: "_id name phone avatarUrl" } });

    // Match the frontend’s plain array expectations (no success wrapper)
    return res.json(posts);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/posts  (multipart form: content, image?, category?)
router.post("/", authGuard, ensureUploadDiskFree, upload.single("image"), async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const content = (req.body?.content || "").toString();
    const userId = req.user?.userId; // from token payload in user routes
    const image = req.file ? req.file.filename : undefined;

    const rawCat = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    const category = CATEGORIES.has(rawCat) ? rawCat : "General";

    const post = await Post.create({ user: userId, content, image, category });
    const populated = await Post.findById(post._id).populate("user", "_id name phone avatarUrl");
    return res.status(201).json({ post: populated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/posts/:id/like (toggle)
router.post("/:id/like", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const has = post.likes.some((l) => l.toString() === userId.toString());
    if (has) {
      post.likes = post.likes.filter((l) => l.toString() !== userId.toString());
    } else {
      post.likes.push(userId);
    }
    await post.save();
    return res.json({ likes: post.likes });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/posts/:id/comment
router.post("/:id/comment", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { content } = req.body || {};
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    post.comments.push({ user: req.user.userId, content: String(content || "") });
    await post.save();
    const populated = await Post.findById(post._id)
      .populate("comments.user", "_id name phone")
      .populate("comments.replies.user", "_id name phone");
    return res.json({ comments: populated?.comments || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/posts/:id/comment/:commentId/reply
router.post("/:id/comment/:commentId/reply", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const { content } = req.body || {};
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, error: "Comment not found" });
    comment.replies.push({ user: req.user.userId, content: String(content || "") });
    await post.save();
    const populated = await Post.findById(post._id)
      .populate("comments.user", "_id name phone")
      .populate("comments.replies.user", "_id name phone");
    return res.json({ comments: populated?.comments || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/posts/:id/share
router.post("/:id/share", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const original = await Post.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, error: "Post not found" });
    original.shares = (original.shares || 0) + 1;
    await original.save();

    const newPost = await Post.create({ user: req.user.userId, sharedFrom: original._id, content: "" });
    const populatedNew = await Post.findById(newPost._id)
      .populate("user", "_id name phone avatarUrl")
      .populate({ path: "sharedFrom", populate: { path: "user", select: "_id name phone avatarUrl" } });

    return res.json({ shares: original.shares, newPost: populatedNew });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/posts/:id (owner only)
router.put("/:id", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    if (post.user?.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    post.content = String(req.body?.content || "");
    await post.save();
    return res.json({ post });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/posts/:id (owner or superadmin)
router.delete("/:id", authGuard, async (req, res) => {
  const guard = ensureMongo(res);
  if (guard) return guard;
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    const superAdminRaw = process.env.ADMIN_PHONE || process.env.SUPERADMIN_PHONE || "+97694641031";
    const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
    let isSuperAdmin = false;
    if (req.user?.phone) {
      isSuperAdmin = onlyDigits(req.user.phone) === onlyDigits(superAdminRaw);
    }
    if (!isSuperAdmin && req.user?.userId) {
      // Fallback: fetch phone from DB in case token lacks phone
      try {
        const u = await User.findById(req.user.userId).select("phone");
        if (u?.phone && onlyDigits(u.phone) === onlyDigits(superAdminRaw)) {
          isSuperAdmin = true;
        }
      } catch (_) {}
    }
    if (post.user?.toString() !== req.user.userId && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    await Post.deleteOne({ _id: post._id });
    if (post.image) {
      deleteUploadedFile(post.image);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
