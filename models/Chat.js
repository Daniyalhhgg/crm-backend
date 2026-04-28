// models/Chat.js
const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    customerName: {
      type: String,
      default: "WhatsApp Customer",
      trim: true,
    },

    customerMessage: {
      type: String,
      default: "",
      trim: true,
    },

    botReply: {
      type: String,
      default: "",
      trim: true,
    },

    // messageId کو non-unique رکھیں (یا ہٹا سکتے ہیں)
    messageId: {
      type: String,
      sparse: true,           // unique: true بالکل ہٹا دیا
    },

    messageType: {
      type: String,
      enum: ["text", "audio", "image", "video", "button"],
      default: "text",
    },

    sender: {
      type: String,
      enum: ["customer", "bot", "admin"],
      default: "customer",
    },

    direction: {
      type: String,
      enum: ["customer_to_bot", "bot_to_customer", "admin_to_customer"],
      default: "customer_to_bot",
    },

    source: {
      type: String,
      default: "whatsapp_ai_bot",
    },

    status: {
      type: String,
      enum: ["sent", "delivered", "read", "failed"],
      default: "sent",
    },

    isBookingRelated: {
      type: Boolean,
      default: false,
    },

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },

    metadata: {
      type: Object,
      default: {}
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Optimized Indexes (duplicate index warning ختم کرنے کے لیے)
chatSchema.index({ restaurantId: 1, customerPhone: 1, createdAt: -1 });
chatSchema.index({ customerPhone: 1 });

module.exports = mongoose.model("Chat", chatSchema);