const mongoose = require("mongoose");

const inviteSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    codeLower: { type: String, required: true, unique: true, index: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    maxUses: { type: Number, default: 1 },
    uses: { type: Number, default: 0 },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    usedAt: { type: Date },
    days: { type: Number, default: 30 },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Invite", inviteSchema);
