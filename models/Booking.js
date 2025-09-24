const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    customer: {
        name: { type: String, trim: true },
        phone: { type: String, trim: true },
    },
    location: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    artist: { type: mongoose.Schema.Types.ObjectId, ref: "Artist", required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    timeslot: { type: String, required: true },
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    notes: { type: String, trim: true },
}, { timestamps: true });

bookingSchema.index({ artist: 1, timeslot: 1 }, { unique: true });
bookingSchema.index({ user: 1, createdAt: -1 });

bookingSchema.pre("validate", function setTimeslot(next) {
    if (this.date && this.time) {
        this.timeslot = `${this.date}T${this.time}`;
    }
    next();
});

module.exports = mongoose.model("Booking", bookingSchema);
