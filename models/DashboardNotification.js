const mongoose = require("mongoose");

const dashboardNotificationSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  sourceKey: { type: String, required: true, trim: true, maxlength: 200 },
  type: {
    type: String,
    required: true,
    enum: ["new_booking", "booking_cancelled", "customer_agreed", "customer_declined", "human_agent", "customer_frustrated"],
  },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  entityType: { type: String, default: "", trim: true, maxlength: 40 },
  entityId: { type: String, default: "", trim: true, maxlength: 100 },
  readAt: { type: Date, default: null, index: true },
}, { timestamps: true });

dashboardNotificationSchema.index({ restaurantId: 1, sourceKey: 1 }, { unique: true });
dashboardNotificationSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("DashboardNotification", dashboardNotificationSchema);
