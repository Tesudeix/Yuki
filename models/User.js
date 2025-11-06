const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: { type: String, required: true, trim: true },
    role: String,
    age: Number,
    avatarUrl: { type: String, trim: true },
    classroomAccess: { type: Boolean, default: false },
    passwordHash: { type: String, select: false },
    hasPassword: { type: Boolean, default: false },
    lastVerifiedAt: Date,
    lastLoginAt: Date,
    lastPasswordResetAt: Date,
}, { timestamps: true });

userSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model("User", userSchema);
