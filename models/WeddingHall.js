const mongoose = require("mongoose");

const weddingHallSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  capacity: { type: Number, min: 1, default: null },
  rentalPrice: { type: Number, min: 0, default: null },
  corporateRentalPrice: { type: Number, min: 0, default: null },
  priceNote: { type: String, default: "+ Tax", trim: true, maxlength: 120 },
  venueType: { type: String, enum: ["wedding_hall", "boardroom"], default: "wedding_hall", index: true },
  setupOptions: { type: [String], default: [] },
  corporateDefaultsVersion: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  defaultDataVersion: { type: Number, default: 0 },
}, { timestamps: true });

weddingHallSchema.index({ restaurantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("WeddingHall", weddingHallSchema);
