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

router.get("/status", async (req, res) => {
    const connectionState = mongoose.connection.readyState;
    const mongo = {
        connected: connectionState === 1,
        status: mongoStateLabels[connectionState] || "unknown",
        database: mongoose.connection.name || null,
    };

    return res.json({
        success: true,
        mongo,
    });
});

const authGuard = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "No token provided" });
        }

        req.user = verifyJwt(token);
        return next();
    } catch (err) {
        return res.status(401).json({ error: "Unauthorized", details: err.message });
    }
};

router.post("/register", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);
    const name = typeof req.body.name === "string" ? req.body.name.trim() || undefined : undefined;

    if (!phone) {
        return res.status(400).json({ error: "Phone number must be provided in E.164 format (e.g. +15551234567)" });
    }

    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: "MongoDB connection unavailable",
            details: mongoStateLabels[mongoose.connection.readyState] || "unknown",
        });
    }

    const validation = validatePassword(passwordInput);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const existing = await User.findOne({ phone }).select("_id");
        if (existing) {
            return res.status(409).json({ error: "This phone number is already registered" });
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

        return res.status(201).json({ success: true, token, user: formatUser(user) });
    } catch (err) {
        return res.status(500).json({ error: "Failed to register", details: err.message });
    }
});

router.post("/login", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);

    if (!phone || !passwordInput) {
        return res.status(400).json({ error: "Phone number (E.164) and password are required" });
    }

    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: "MongoDB connection unavailable",
            details: mongoStateLabels[mongoose.connection.readyState] || "unknown",
        });
    }

    try {
        const user = await User.findOne({ phone }).select("+passwordHash");

        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: "Invalid phone number or password" });
        }

        const passwordMatches = await bcrypt.compare(passwordInput, user.passwordHash);

        if (!passwordMatches) {
            return res.status(401).json({ error: "Invalid phone number or password" });
        }

        user.lastLoginAt = new Date();
        user.hasPassword = true;
        await user.save();

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return res.json({ success: true, token, user: formatUser(user) });
    } catch (err) {
        return res.status(500).json({ error: "Failed to sign in", details: err.message });
    }
});

router.post("/password/change", authGuard, async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: "MongoDB connection unavailable",
            details: mongoStateLabels[mongoose.connection.readyState] || "unknown",
        });
    }

    const currentPassword = normalizePassword(req.body.currentPassword);
    const newPassword = normalizePassword(req.body.newPassword);

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Both currentPassword and newPassword are required" });
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const user = await User.findById(req.user.userId).select("+passwordHash");
        if (!user || !user.passwordHash) {
            return res.status(404).json({ error: "User not found" });
        }

        const matches = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!matches) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }

        user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        user.hasPassword = true;
        user.lastPasswordResetAt = new Date();
        await user.save();

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: "Failed to change password", details: err.message });
    }
});

router.get("/profile", authGuard, async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                error: "MongoDB connection unavailable",
                details: mongoStateLabels[mongoose.connection.readyState] || "unknown",
            });
        }

        const user = await User.findOne({ phone: req.user.phone }).lean();

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.json({ success: true, user: formatUser(user) });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
