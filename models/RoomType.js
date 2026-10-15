const mongoose = require("mongoose");

const roomTypeSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: "", trim: true, maxlength: 1000 },
  baseRate: { type: Number, required: true, min: 0, default: 0 },
  totalRooms: { type: Number, required: true, min: 1, max: 10000, default: 1 },
  maxGuestsPerRoom: { type: Number, min: 1, max: 30, default: null },
  amenities: { type: [String], default: [] },
  imageUrls: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

roomTypeSchema.index({ restaurantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("RoomType", roomTypeSchema);
