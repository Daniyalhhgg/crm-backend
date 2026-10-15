const mongoose = require("mongoose");

const roomInventorySchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  roomTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "RoomType", required: true, index: true },
  date: { type: Date, required: true, index: true },
  blockedRooms: { type: Number, min: 0, default: 0 },
  note: { type: String, default: "", trim: true, maxlength: 300 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

roomInventorySchema.index({ restaurantId: 1, roomTypeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("RoomInventory", roomInventorySchema);
