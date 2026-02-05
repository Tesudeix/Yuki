const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    // Product category for marketplace filtering
    category: {
      type: String,
      enum: [
        "Хоол",
        "Хүнс",
        "Бөөнний түгээлт",
        "Урьдчилсан захиалга",
        "Кофе амттан",
        "Алкохол",
        "Гэр ахуй & хүүхэд",
        "Эргэнэтэд үйлдвэрлэв",
        "Бэлэг & гоо сайхан",
        "Гадаад захиалга",
      ],
      required: true,
      trim: true,
    },
    image: { type: String },
    description: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", productSchema);
