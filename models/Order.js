const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
    {
        /* ======================
           OWNERSHIP
        ====================== */
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        /* ======================
           IDENTIFICATION
        ====================== */
        trackingNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        /* ======================
           ROUTE
        ====================== */
        fromCountry: {
            type: String,
            default: "CN",
            uppercase: true,
        },

        toCountry: {
            type: String,
            default: "MN",
            uppercase: true,
        },

        /* ======================
           CARGO DATA
        ====================== */
        weightKg: {
            type: Number,
            default: 0,
            min: 0,
        },

        price: {
            type: Number,
            default: 0,
            min: 0,
        },

        priceUpdatedAt: Date,
        weightUpdatedAt: Date,

        /* ======================
           STATUS
        ====================== */
        status: {
            type: String,
            enum: [
                "CREATED",
                "RECEIVED",
                "IN_TRANSIT",
                "ARRIVED",
                "DELIVERED",
                "CANCELLED",
            ],
            default: "CREATED",
            index: true,
        },

        statusHistory: [
            {
                status: String,
                changedAt: { type: Date, default: Date.now },
                by: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User", // operator or admin
                },
            },
        ],

        /* ======================
           STAFF TRACEABILITY
        ====================== */
        lastUpdatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        /* ======================
           NOTES & CANCELLATION
        ====================== */
        note: {
            type: String,
            trim: true,
        },

        cancelReason: {
            type: String,
            trim: true,
        },

        /* ======================
           SOFT DELETE
        ====================== */
        isArchived: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    { timestamps: true }
);

/* ======================
   INDEXES
====================== */
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Order", OrderSchema);
