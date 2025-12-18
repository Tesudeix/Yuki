const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const router = express.Router();

const User = require("../models/User");
const { createToken, verifyToken: verifyJwt } = require("../auth");

/* ======================
   CONSTANTS
====================== */
const E164_REGEX = /^\+\d{9,15}$/;
const MIN_PASSWORD_LENGTH = 6;
const BCRYPT_ROUNDS = 10;

const ADMIN_FALLBACK_PHONE = (
    process.env.ADMIN_PHONE ||
    process.env.SUPERADMIN_PHONE ||
    "+97694641031"
).trim();

const ADMIN_FALLBACK_PASSWORD = (
    process.env.ADMIN_PASSWORD ||
    "tesu123$"
).trim();

/* ======================
   HELPERS
====================== */
const sanitizePhone = (phone) => {
    if (typeof phone !== "string") return null;
    const cleaned = phone.trim().replace(/[^\d+]/g, "");
    if (!cleaned) return null;

    if (cleaned.startsWith("+")) {
        const normalized = `+${cleaned.slice(1).replace(/\D/g, "")}`;
        return E164_REGEX.test(normalized) ? normalized : null;
    }

    const digits = cleaned.replace(/\D/g, "");
    return E164_REGEX.test(`+${digits}`) ? `+${digits}` : null;
};

const normalizePassword = (p) =>
    typeof p === "string" ? p.trim() : "";

const validatePassword = (p) => {
    if (!p) return { ok: false, error: "Password is required" };
    if (p.length < MIN_PASSWORD_LENGTH) {
        return {
            ok: false,
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        };
    }
    return { ok: true };
};

const formatUser = (u) => {
    if (!u) return null;
    const d = typeof u.toObject === "function" ? u.toObject() : u;

    return {
        id: String(d._id),
        phone: d.phone,
        name: d.name ?? null,
        email: d.email ?? null,
        role: d.role ?? null,
        classroomAccess: Boolean(d.classroomAccess),
        avatarUrl: d.avatarUrl ?? null,
        age: typeof d.age === "number" ? d.age : null,
        lastVerifiedAt: d.lastVerifiedAt ?? null,
        lastLoginAt: d.lastLoginAt ?? null,
        lastPasswordResetAt: d.lastPasswordResetAt ?? null,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
        hasPassword: Boolean(d.hasPassword),
    };
};

const sendSuccess = (res, status, payload = {}) =>
    res.status(status).json({ success: true, ...payload });

const sendError = (res, status, error, extra = {}) =>
    res.status(status).json({ success: false, error, ...extra });

const ensureMongo = (res) => {
    if (mongoose.connection.readyState !== 1) {
        return sendError(res, 503, "MongoDB not connected");
    }
    return null;
};

/* ======================
   AUTH GUARD
====================== */
const authGuard = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return sendError(res, 401, "No token");
        req.user = verifyJwt(token);
        next();
    } catch (e) {
        return sendError(res, 401, "Unauthorized", { details: e.message });
    }
};

/* ======================
   ROUTES
====================== */

// STATUS
router.get("/status", (req, res) => {
    sendSuccess(res, 200, {
        mongo: mongoose.connection.readyState === 1,
    });
});

// REGISTER (user only)
router.post("/register", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const password = normalizePassword(req.body.password);
    const name =
        typeof req.body.name === "string" ? req.body.name.trim() : undefined;

    if (!phone) {
        return sendError(res, 400, "Invalid phone format");
    }

    const mongoGuard = ensureMongo(res);
    if (mongoGuard) return mongoGuard;

    const v = validatePassword(password);
    if (!v.ok) return sendError(res, 400, v.error);

    try {
        const exists = await User.findOne({ phone }).select("_id");
        if (exists) return sendError(res, 409, "Phone already registered");

        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const user = await User.create({
            phone,
            name,
            passwordHash: hash,
            hasPassword: true,
            role: "user",
            lastLoginAt: new Date(),
            lastVerifiedAt: new Date(),
        });

        const token = createToken({
            phone: user.phone,
            userId: user._id.toString(),
            role: user.role || "user",
        });

        return sendSuccess(res, 201, { token, user: formatUser(user) });
    } catch (e) {
        return sendError(res, 500, "Register failed", { details: e.message });
    }
});

// LOGIN (with fallback admin)
router.post("/login", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const password = normalizePassword(req.body.password);

    if (!phone || !password) {
        return sendError(res, 400, "Phone and password required");
    }

    const mongoGuard = ensureMongo(res);
    if (mongoGuard) return mongoGuard;

    try {
        let user = await User.findOne({ phone }).select("+passwordHash");

        // FALLBACK ADMIN
        if (!user || !user.passwordHash) {
            const adminPhone = sanitizePhone(ADMIN_FALLBACK_PHONE);
            if (adminPhone && phone === adminPhone && password === ADMIN_FALLBACK_PASSWORD) {
                const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

                user = await User.findOneAndUpdate(
                    { phone },
                    {
                        $set: {
                            phone,
                            passwordHash: hash,
                            hasPassword: true,
                            name: "Суперадмин",
                            role: "admin",
                            roleAssignedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true }
                ).select("+passwordHash");
            } else {
                return sendError(res, 401, "Invalid credentials");
            }
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return sendError(res, 401, "Invalid credentials");

        user.lastLoginAt = new Date();
        await user.save();

        const token = createToken({
            phone: user.phone,
            userId: user._id.toString(),
            role: user.role || "user",
        });

        return sendSuccess(res, 200, { token, user: formatUser(user) });
    } catch (e) {
        return sendError(res, 500, "Login failed", { details: e.message });
    }
});

// PROFILE
router.get("/profile", authGuard, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).lean();
        if (!user) return sendError(res, 404, "User not found");
        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (e) {
        return sendError(res, 500, "Profile load failed");
    }
});

module.exports = router;
