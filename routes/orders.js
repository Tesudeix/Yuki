const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const { verifyToken } = require("../auth");

const router = express.Router();

/* ======================
   AUTH GUARD (USER)
====================== */
const authGuard = (req, res, next) => {
    try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        if (!token) {
            return res.status(401).json({ success: false, error: "No token" });
        }

        const payload = verifyToken(token);

        if (!payload?.userId) {
            return res.status(401).json({
                success: false,
                error: "Invalid token payload",
            });
        }

        req.user = {
            userId: payload.userId,
            role: payload.role || "user",
            phone: payload.phone || null,
        };

        next();
    } catch (e) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
            details: e.message,
        });
    }
};

/* ======================
   CREATE ORDER (USER)
====================== */
router.post("/", authGuard, async (req, res) => {
    try {
        const trackingNumber = String(req.body?.trackingNumber || "").trim();
        const note =
            typeof req.body?.note === "string" ? req.body.note.trim() : "";

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                error: "trackingNumber required",
            });
        }

        const exists = await Order.findOne({ trackingNumber }).select("_id");
        if (exists) {
            return res.status(409).json({
                success: false,
                error: "Tracking already exists",
            });
        }

        const order = await Order.create({
            userId: req.user.userId,
            trackingNumber,
            note,
        });

        return res.status(201).json({ success: true, order });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: e.message,
        });
    }
});

/* ======================
   LIST MY ORDERS
====================== */
router.get("/", authGuard, async (req, res) => {
    try {
        const orders = await Order.find({
            userId: req.user.userId,
        }).sort({ createdAt: -1 });

        return res.json({ success: true, orders });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: e.message,
        });
    }
});

/* ======================
   ORDER DETAIL (MY ORDER)
====================== */
router.get("/:id", authGuard, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid id",
            });
        }

        const order = await Order.findOne({
            _id: id,
            userId: req.user.userId,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: "Order not found",
            });
        }

        return res.json({ success: true, order });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: e.message,
        });
    }
});

module.exports = router;
