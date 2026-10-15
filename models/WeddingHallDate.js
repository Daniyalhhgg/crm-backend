const mongoose = require("mongoose");

const weddingHallDateSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  hallId: { type: mongoose.Schema.Types.ObjectId, ref: "WeddingHall", required: true, index: true },
  date: { type: Date, required: true, index: true },
  status: { type: String, enum: ["available", "booked", "blocked"], default: "available", index: true },
  note: { type: String, default: "", trim: true, maxlength: 500 },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "WeddingBooking", default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

weddingHallDateSchema.index({ restaurantId: 1, hallId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("WeddingHallDate", weddingHallDateSchema);
