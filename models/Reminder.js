const mongoose = require("mongoose");

const ReminderSchema = new mongoose.Schema({
  fromNumber:      { type: String, required: true },
  restaurantId:    { type: String, default: "restaurant-1" },
  bookingId:       { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
  customerName:    { type: String, default: "" },

  reason: {
    type: String,
    enum: ["payment_pending", "booking_later", "visit_later", "general"],
    required: true,
  },

  reminderDate:    { type: String, required: true },   // "2026-05-25"
  reminderTime:    { type: String, required: true },   // "10:00 AM"
  reminderAt:      { type: Date,   default: null },    // optional — set by backend scheduler
  sourceMessageId: { type: String, trim: true, sparse: true, unique: true },
  customerWindowExpiresAt: { type: Date, default: null },

  customerMessage: { type: String, default: "" },
  source:          { type: String, default: "whatsapp_bot" },

  status: {
    type: String,
    enum: ["pending", "sending", "sent", "completed", "cancelled", "failed"],
    default: "pending",
  },

  jobId:       { type: String, default: null },
  autoReplySent: { type: Boolean, default: false },
  autoReplyMessage: { type: String, default: "" },
  lastError: { type: String, default: "", maxlength: 500 },
  createdAt:   { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
});

module.exports = mongoose.model("Reminder", ReminderSchema);
