const mongoose = require("mongoose");

const adminUserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    lastLoginAt: Date,
}, { timestamps: true });

adminUserSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model("AdminUser", adminUserSchema);
