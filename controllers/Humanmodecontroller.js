// controllers/humanModeController.js
const axios = require("axios");
const Chat = require("../models/Chat");

const store = {};   // temporary in-memory store

// n8n ke liye - NO auth
exports.checkHumanMode = (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, ""); // clean phone
  const humanMode = store[phone]?.on || false;

  console.log(`[Check Human Mode] ${phone} → ${humanMode}`);

  res.json({
    success: true,
    humanMode: humanMode,
    phone: phone
  });
};

// dashboard se toggle
exports.toggleHumanMode = (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, "");
  const { humanMode } = req.body;

  store[phone] = { on: !!humanMode, updatedAt: new Date() };

  console.log(`[Toggle Human Mode] ${phone} → ${humanMode ? "ON" : "OFF"}`);

  const io = req.app.get("io");
  if (io) io.to("chat-admins").emit("human-mode-changed", { phone, humanMode: !!humanMode });

  res.json({ success: true, phone, humanMode: !!humanMode });
};

// agent reply
exports.sendAgentReply = async (req, res) => {
  try {
    const { toPhone, message } = req.body;
    if (!toPhone || !message) {
      return res.status(400).json({ success: false, message: "toPhone and message required" });
    }

    const phone = toPhone.replace(/[^0-9]/g, "");

    // WhatsApp Cloud API call
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Save in DB as admin message
    const savedChat = await Chat.create({
      restaurantId: req.admin?.restaurantId || "restaurant-1",
      customerPhone: phone,
      botReply: message,
      sender: "admin",
      direction: "admin_to_customer",
      source: "human_agent",
    });

    // Realtime update
    const io = req.app.get("io");
    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone,
        message: message,
        isBot: false,
        sender: "admin",
        timestamp: new Date()
      });
    }

    res.json({ success: true, message: "Reply sent successfully" });
  } catch (error) {
    console.error("Agent Reply Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};