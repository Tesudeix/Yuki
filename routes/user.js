const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/User");
const { client: twilioClient, verifyServiceSid, checkVerifyService } = require("../twilio");
const { createToken, verifyToken: verifyJwt } = require("../auth");

const E164_REGEX = /^\+\d{9,15}$/;

const sanitizePhone = (phone) => {
    if (typeof phone !== "string") {
        return null;
    }

    const normalized = phone.replace(/\s+/g, "");
    return E164_REGEX.test(normalized) ? normalized : null;
};

const formatUser = (userDoc) => {
    if (!userDoc) {
        return null;
    }

    const doc = typeof userDoc.toObject === "function" ? userDoc.toObject() : userDoc;

    return {
        id: doc._id?.toString?.() ?? doc.id ?? null,
        phone: doc.phone,
        name: doc.name ?? null,
        email: doc.email ?? null,
        role: doc.role ?? null,
        age: typeof doc.age === "number" ? doc.age : null,
        lastVerifiedAt: doc.lastVerifiedAt ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null,
    };
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

    try {
        const twilioStatus = await checkVerifyService();

        return res.json({
            success: true,
            mongo,
            twilio: twilioStatus.ok
                ? { ok: true, service: twilioStatus.service, checkedAt: twilioStatus.timestamp }
                : { ok: false, error: twilioStatus.error, checkedAt: twilioStatus.timestamp },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: "Failed to compute service status",
            details: err.message,
            mongo,
        });
    }
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

router.get("/otp/status", async (req, res) => {
    try {
        const status = await checkVerifyService();

        if (!status.ok) {
            return res.status(503).json({
                success: false,
                error: "Twilio Verify service is not currently available",
                details: status.error,
            });
        }

        return res.json({ success: true, service: status.service });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: "Unable to check Twilio Verify service",
            details: err.message,
        });
    }
});

router.post("/otp/send", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);

    if (!phone) {
        return res.status(400).json({ error: "Phone number must be provided in E.164 format (e.g. +15551234567)" });
    }

    try {
        const status = await checkVerifyService();

        if (!status.ok) {
            return res.status(503).json({
                error: "Twilio Verify service unavailable",
                details: status.error,
            });
        }

        const verification = await twilioClient.verify.v2
            .services(verifyServiceSid)
            .verifications.create({ to: phone, channel: "sms" });

        return res.json({ success: true, status: verification.status });
    } catch (err) {
        return res.status(500).json({ error: "Failed to send OTP", details: err.message });
    }
});

router.post("/otp/verify", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const code = req.body.code?.trim();

    if (!phone || !code) {
        return res.status(400).json({ error: "Phone number (E.164) and verification code are required" });
    }

    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: "MongoDB connection unavailable",
            details: mongoStateLabels[mongoose.connection.readyState] || "unknown",
        });
    }

    try {
        const status = await checkVerifyService();

        if (!status.ok) {
            return res.status(503).json({
                error: "Twilio Verify service unavailable",
                details: status.error,
            });
        }

        const verification = await twilioClient.verify.v2
            .services(verifyServiceSid)
            .verificationChecks.create({ to: phone, code });

        if (verification.status !== "approved") {
            return res.status(401).json({ error: "Invalid or expired OTP" });
        }

        const now = new Date();
        const user = await User.findOneAndUpdate(
            { phone },
            {
                $set: { lastVerifiedAt: now },
                $setOnInsert: { phone },
            },
            {
                new: true,
                upsert: true,
            },
        );

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return res.json({ success: true, token, user: formatUser(user) });
    } catch (err) {
        return res.status(500).json({ error: "Failed to verify OTP", details: err.message });
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
