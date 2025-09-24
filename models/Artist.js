const mongoose = require("mongoose");

const artistSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    bio: { type: String, trim: true },
    specialties: [{ type: String, trim: true }],
    avatarUrl: { type: String, trim: true },
    locations: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    active: { type: Boolean, default: true },
}, { timestamps: true });

artistSchema.index({ locations: 1, active: 1 });
artistSchema.index({ active: 1 });

module.exports = mongoose.model("Artist", artistSchema);
