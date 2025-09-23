const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: { type: String, unique: true, required: true },
    role: String,
    age: Number,
    lastVerifiedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
