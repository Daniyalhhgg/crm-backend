const mongoose = require("mongoose");

const inquiryLearningSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, trim: true, index: true },
  question: { type: String, required: true, trim: true, maxlength: 1000 },
  answer: { type: String, required: true, trim: true, maxlength: 5000 },
  category: { type: String, default: "Other Questions", trim: true, maxlength: 100 },
  sourceChatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", default: null, index: true },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: String, default: "", trim: true, maxlength: 160 },
  updatedBy: { type: String, default: "", trim: true, maxlength: 160 },
}, { timestamps: true });

inquiryLearningSchema.index({ restaurantId: 1, isActive: 1, updatedAt: -1 });

module.exports = mongoose.model("InquiryLearning", inquiryLearningSchema);
