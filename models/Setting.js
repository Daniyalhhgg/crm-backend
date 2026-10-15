const mongoose = require("mongoose");

const agentPromptVersionSchema = new mongoose.Schema({
  revision: { type: Number, required: true },
  content: { type: String, required: true, maxlength: 50000 },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: String, default: "System", trim: true, maxlength: 160 },
}, { _id: false });

const settingSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, unique: true, trim: true },
  followUpReminderDelayMinutes: { type: Number, default: 1440, min: 1, max: 43200 },
  loyalty: {
    enabled: { type: Boolean, default: true },
    visitsForReward: { type: Number, default: 5, min: 1, max: 100 },
    rewardText: { type: String, default: "Chef Special Dessert", trim: true, maxlength: 160 },
  },
  serviceClosures: [{
    _id: false,
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    updatedAt: { type: Date, default: Date.now },
  }],
  agentPrompt: {
    content: { type: String, default: "", maxlength: 50000 },
    revision: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: "", trim: true, maxlength: 160 },
    history: { type: [agentPromptVersionSchema], default: [] },
  },
}, { timestamps: true });

module.exports = mongoose.model("Setting", settingSchema);
