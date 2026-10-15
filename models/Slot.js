const mongoose = require("mongoose");

const STATUSES = ["available", "limited", "full"];
const CATEGORIES = [
  "Hi-Tea Buffet",
  "Dinner Buffet",
  "Pool/Gym",
  "Wedding",
  "Rooms",
  "D'Fusion Revolving Restaurant: A La Carte Menu",
  "À la carte / Restaurant Reservation",
  "Auditorium / Movie Night + Hi-Tea",
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeSlotSchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true, maxlength: 40 },
    startTime: { type: String, required: true, match: TIME_RE },
    endTime: { type: String, required: true, match: TIME_RE },
    status: { type: String, enum: STATUSES, default: "available" },
    note: { type: String, default: "", trim: true, maxlength: 200 },
    capacity: { type: Number, default: 0, min: 0, max: 100000 },
    booked: { type: Number, default: 0, min: 0, max: 100000 },
  },
  { _id: true }
);

const slotSchema = new mongoose.Schema(
  {
    restaurantId: { type: String, required: true, index: true, trim: true },
    date: { type: Date, required: true, index: true },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    status: { type: String, enum: STATUSES, default: "available", index: true },
    note: { type: String, default: "", trim: true },
    timeSlots: { type: [timeSlotSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

slotSchema.index({ restaurantId: 1, date: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Slot", slotSchema);
