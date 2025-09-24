const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema({
    time: { type: String, required: true }, // HH:mm format
    isBooked: { type: Boolean, default: false },
}, { _id: false });

const artistAvailabilitySchema = new mongoose.Schema({
    location: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    artist: { type: mongoose.Schema.Types.ObjectId, ref: "Artist", required: true },
    date: { type: String, required: true }, // ISO date (YYYY-MM-DD)
    slots: { type: [slotSchema], default: [] },
}, { timestamps: true });

artistAvailabilitySchema.index({ artist: 1, location: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("ArtistAvailability", artistAvailabilitySchema);
