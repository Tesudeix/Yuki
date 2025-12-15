const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        /* ======================
           IDENTITY
        ====================== */
        name: {
            type: String,
            trim: true,
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
        },

        phone: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        avatarUrl: {
            type: String,
            trim: true,
        },

        age: Number,

        /* ======================
           AUTH & ROLE
        ====================== */
        role: {
            type: String,
            enum: ["user", "operator", "admin"],
            default: "user",
            index: true,
        },

        roleAssignedAt: Date,
        roleAssignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // admin who promoted
        },

        passwordHash: {
            type: String,
            select: false,
        },

        hasPassword: {
            type: Boolean,
            default: false,
        },

        /* ======================
           ACCESS CONTROL
        ====================== */
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        suspendedAt: Date,
        suspensionReason: {
            type: String,
            trim: true,
        },

        /* ======================
           PRODUCT / MEMBERSHIP
        ====================== */
        classroomAccess: {
            type: Boolean,
            default: false,
        },

        membershipExpiresAt: Date,

        /* ======================
           AUDIT
        ====================== */
        lastVerifiedAt: Date,
        lastLoginAt: Date,
        lastPasswordResetAt: Date,
    },
    { timestamps: true }
);

/* ======================
   INDEXES
====================== */
userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
