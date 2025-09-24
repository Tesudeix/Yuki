const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: { type: String, unique: true, required: true },
    role: String,
    age: Number,
    passwordHash: { type: String, select: false },
    hasPassword: { type: Boolean, default: false },
    lastVerifiedAt: Date,
    lastLoginAt: Date,
    lastPasswordResetAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
