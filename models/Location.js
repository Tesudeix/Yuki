const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, unique: true, sparse: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    workingHours: { type: String, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
}, { timestamps: true });

locationSchema.index({ active: 1, order: 1 });
locationSchema.index({ slug: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Location", locationSchema);
