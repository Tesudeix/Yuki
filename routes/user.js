const express = require("express");
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

        let user = await User.findOne({ phone });

        if (!user) {
            user = new User({ phone });
            await user.save();
        }

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return res.json({ success: true, token, user });
    } catch (err) {
        return res.status(500).json({ error: "Failed to verify OTP", details: err.message });
    }
});

router.get("/profile", authGuard, async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.user.phone });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.json({ success: true, user });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
