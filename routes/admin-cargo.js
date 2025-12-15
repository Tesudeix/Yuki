const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const { verifyToken } = require("../auth");

const router = express.Router();

/* ======================
   CARGO STAFF AUTH
====================== */
const requireCargoStaff = (req, res, next) => {
    try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ")
            ? auth.slice(7).trim()
            : null;

        if (!token) {
            return res.status(401).json({ success: false, error: "No token" });
        }

        const payload = verifyToken(token);

        const isAdmin =
            payload?.role === "admin" &&
            (payload?.adminId || payload?.userId);

        const isOperator =
            payload?.role === "operator" &&
            payload?.userId;

        if (!isAdmin && !isOperator) {
            return res.status(403).json({ success: false, error: "Forbidden" });
        }

        req.staff = payload;
        next();
    } catch (e) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
            details: e.message,
        });
    }
};

const ALLOWED_STATUSES = new Set([
    "CREATED",
    "RECEIVED",
    "IN_TRANSIT",
    "ARRIVED",
    "DELIVERED",
    "CANCELLED",
]);

/* ======================
   LIST ALL ORDERS
====================== */
router.get("/orders", requireCargoStaff, async (req, res) => {
    const orders = await Order.find()
        .populate("userId", "phone name role")
        .sort({ createdAt: -1 });

    res.json({ success: true, orders });
});

/* ======================
   ORDER DETAIL
====================== */
router.get("/orders/:id", requireCargoStaff, async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: "Invalid id" });
    }

    const order = await Order.findById(id)
        .populate("userId", "phone name role");

    if (!order) {
        return res.status(404).json({ success: false, error: "Not found" });
    }

    res.json({ success: true, order });
});

/* ======================
   CREATE ORDER (STAFF)
====================== */
router.post("/orders", requireCargoStaff, async (req, res) => {
    try {
        const trackingNumber = String(req.body?.trackingNumber || "").trim();
        const note =
            typeof req.body?.note === "string" ? req.body.note.trim() : "";
        const userPhone =
            typeof req.body?.userPhone === "string" ? req.body.userPhone.trim() : "";
        const userId =
            typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

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

        let owner = null;

        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            owner = await User.findById(userId).select("_id");
        } else if (userPhone) {
            owner = await User.findOne({ phone: userPhone }).select("_id");
        }

        if (!owner) {
            return res.status(400).json({
                success: false,
                error: "Valid userId or userPhone required",
            });
        }

        const order = await Order.create({
            userId: owner._id,
            trackingNumber,
            note,
        });

        res.status(201).json({ success: true, order });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/* ======================
   UPDATE ORDER
====================== */
router.put("/orders/:id", requireCargoStaff, async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: "Invalid id" });
    }

    const updates = {};

    if (typeof req.body?.weightKg === "number") updates.weightKg = req.body.weightKg;
    if (typeof req.body?.price === "number") updates.price = req.body.price;
    if (typeof req.body?.note === "string") updates.note = req.body.note.trim();

    if (req.body?.status) {
        const nextStatus = String(req.body.status).trim();
        if (!ALLOWED_STATUSES.has(nextStatus)) {
            return res.status(400).json({ success: false, error: "Invalid status" });
        }
        updates.status = nextStatus;
    }

    const order = await Order.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
    ).populate("userId", "phone name role");

    if (!order) {
        return res.status(404).json({ success: false, error: "Order not found" });
    }

    res.json({ success: true, order });
});

module.exports = router;
