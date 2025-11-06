const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const router = express.Router();

const User = require("../models/User");
const { createToken, verifyToken: verifyJwt } = require("../auth");

const E164_REGEX = /^\+\d{9,15}$/;
const MIN_PASSWORD_LENGTH = 6;
const BCRYPT_ROUNDS = 10;

const sanitizePhone = (phone) => {
    if (typeof phone !== "string") {
        return null;
    }

    const stripped = phone.trim();
    const keepCharacters = stripped.replace(/[^\d+]/g, "");

    if (!keepCharacters) {
        return null;
    }

    if (keepCharacters.startsWith("+")) {
        const normalized = `+${keepCharacters.slice(1).replace(/\D/g, "")}`;
        return E164_REGEX.test(normalized) ? normalized : null;
    }

    const digitsOnly = keepCharacters.replace(/\D/g, "");
    return E164_REGEX.test(`+${digitsOnly}`) ? `+${digitsOnly}` : null;
};

const formatUser = (userDoc) => {
    if (!userDoc) {
        return null;
    }

    const doc = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };

    const { _id, passwordHash, hasPassword } = doc;

    return {
        id: typeof _id?.toString === "function" ? _id.toString() : doc.id ?? null,
        phone: doc.phone,
        name: doc.name ?? null,
        email: doc.email ?? null,
        role: doc.role ?? null,
        age: typeof doc.age === "number" ? doc.age : null,
        avatarUrl: doc.avatarUrl ?? null,
        lastVerifiedAt: doc.lastVerifiedAt ?? null,
        lastLoginAt: doc.lastLoginAt ?? null,
        lastPasswordResetAt: doc.lastPasswordResetAt ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null,
        hasPassword: Boolean(passwordHash) || Boolean(hasPassword),
    };
};

const normalizePassword = (password) => (typeof password === "string" ? password.trim() : "");

const validatePassword = (password) => {
    if (!password) {
        return { ok: false, error: "Password is required" };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return {
            ok: false,
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
        };
    }

    return { ok: true };
};

const mongoStateLabels = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
};

const sendSuccess = (res, status, payload = {}) => res.status(status).json({ success: true, ...payload });
const sendError = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra });
const ensureMongoConnection = (res) => {
    const state = mongoose.connection.readyState;
    if (state !== 1) {
        return sendError(res, 503, "MongoDB connection unavailable", {
            details: mongoStateLabels[state] || "unknown",
        });
    }
    return null;
};

router.get("/status", async (req, res) => {
    const connectionState = mongoose.connection.readyState;
    const mongo = {
        connected: connectionState === 1,
        status: mongoStateLabels[connectionState] || "unknown",
        database: mongoose.connection.name || null,
    };

    return sendSuccess(res, 200, { mongo });
});

const authGuard = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return sendError(res, 401, "No token provided");
        }

        req.user = verifyJwt(token);
        return next();
    } catch (err) {
        return sendError(res, 401, "Unauthorized", { details: err.message });
    }
};

router.post("/register", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);
    const name = typeof req.body.name === "string" ? req.body.name.trim() || undefined : undefined;

    if (!phone) {
        return sendError(res, 400, "Phone number must be provided in E.164 format (e.g. +15551234567)");
    }

    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    const validation = validatePassword(passwordInput);
    if (!validation.ok) {
        return sendError(res, 400, validation.error);
    }

    try {
        const existing = await User.findOne({ phone }).select("_id");
        if (existing) {
            return sendError(res, 409, "This phone number is already registered");
        }

        const now = new Date();
        const passwordHash = await bcrypt.hash(passwordInput, BCRYPT_ROUNDS);

        const user = await User.create({
            phone,
            name,
            passwordHash,
            hasPassword: true,
            lastLoginAt: now,
            lastVerifiedAt: now,
        });

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return sendSuccess(res, 201, { token, user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to register", { details: err.message });
    }
});

router.post("/login", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);

    if (!phone || !passwordInput) {
        return sendError(res, 400, "Phone number (E.164) and password are required");
    }

    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        const user = await User.findOne({ phone }).select("+passwordHash");

        if (!user || !user.passwordHash) {
            return sendError(res, 401, "Invalid phone number or password");
        }

        const passwordMatches = await bcrypt.compare(passwordInput, user.passwordHash);

        if (!passwordMatches) {
            return sendError(res, 401, "Invalid phone number or password");
        }

        user.lastLoginAt = new Date();
        user.hasPassword = true;
        await user.save();

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return sendSuccess(res, 200, { token, user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to sign in", { details: err.message });
    }
});

router.post("/password/change", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    const currentPassword = normalizePassword(req.body.currentPassword);
    const newPassword = normalizePassword(req.body.newPassword);

    if (!currentPassword || !newPassword) {
        return sendError(res, 400, "Both currentPassword and newPassword are required");
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
        return sendError(res, 400, validation.error);
    }

    try {
        const user = await User.findById(req.user.userId).select("+passwordHash");
        if (!user || !user.passwordHash) {
            return sendError(res, 404, "User not found");
        }

        const matches = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!matches) {
            return sendError(res, 401, "Current password is incorrect");
        }

        user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        user.hasPassword = true;
        user.lastPasswordResetAt = new Date();
        await user.save();

        return sendSuccess(res, 200, {});
    } catch (err) {
        return sendError(res, 500, "Failed to change password", { details: err.message });
    }
});

router.get("/profile", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        const user = await User.findOne({ phone: req.user.phone }).lean();

        if (!user) {
            return sendError(res, 404, "User not found");
        }

        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to load profile", { details: err.message });
    }
});

// Update the authenticated user's avatar URL
// Accepts either Authorization: Bearer <jwt> (preferred) OR X-User-Id header for compatibility
router.patch("/profile/avatar", async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        const rawAuth = req.headers.authorization || "";
        const bearer = rawAuth.startsWith("Bearer ") ? rawAuth.slice(7).trim() : null;
        let userId = null;
        if (bearer) {
            try {
                const payload = verifyJwt(bearer);
                userId = payload?.userId || null;
            } catch (e) {
                // ignore and fall back to header
                userId = null;
            }
        }

        if (!userId) {
            const headerId = req.get("x-user-id") || req.get("X-User-Id");
            userId = headerId ? String(headerId).trim() : null;
        }

        if (!userId) {
            return sendError(res, 401, "Missing user identity");
        }

        const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl.trim() : "";
        if (!avatarUrl) {
            return sendError(res, 400, "avatarUrl is required");
        }

        // Accept either ObjectId or string ids
        let query;
        if (mongoose.Types.ObjectId.isValid(userId)) {
            query = { _id: new mongoose.Types.ObjectId(userId) };
        } else {
            query = { _id: userId };
        }

        const user = await User.findOneAndUpdate(
            query,
            { $set: { avatarUrl } },
            { new: true },
        );

        if (!user) {
            return sendError(res, 404, "User not found");
        }

        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to update avatar", { details: err.message });
    }
});

module.exports = router;
