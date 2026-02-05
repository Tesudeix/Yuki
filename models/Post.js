const mongoose = require("mongoose");

const ObjectId = mongoose.Schema.Types.ObjectId;

const replySchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User" },
    content: { type: String, trim: true },
  },
  { _id: true, timestamps: true },
);

const commentSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User" },
    content: { type: String, trim: true },
    replies: [replySchema],
  },
  { _id: true, timestamps: true },
);

const postSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User" },
    content: { type: String, trim: true },
    image: { type: String },
    images: [{ type: String }],
    category: { type: String, enum: ["General", "News", "Tools", "Tasks", "Antaqor", "Community"], default: "General", index: true },
    likes: [{ type: ObjectId, ref: "User" }],
    comments: [commentSchema],
    shares: { type: Number, default: 0 },
    sharedFrom: { type: ObjectId, ref: "Post" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Post", postSchema);
