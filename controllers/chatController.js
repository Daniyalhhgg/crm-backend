const Chat = require('../models/Chat');

// ======================
// Get all chats (Admin)
// ======================
exports.getAllChats = async (req, res) => {
  try {
    // 🔥 Use restaurantId from middleware
    const restaurantId = req.admin.restaurantId;
    
    console.log(`\n📥 getAllChats:`);
    console.log(`   Admin: ${req.admin.email}`);
    console.log(`   Restaurant: ${restaurantId}`);

    const chats = await Chat.find({
      restaurantId: restaurantId
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${chats.length} chats`);

    res.status(200).json({
      success: true,
      data: chats,
      count: chats.length
    });
  } catch (error) {
    console.error("❌ Get All Chats Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Get chat by phone
// ======================
exports.getChatByCustomer = async (req, res) => {
  try {
    const { phone } = req.params;
    const restaurantId = req.admin.restaurantId;

    console.log(`\n📥 getChatByCustomer:`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Restaurant: ${restaurantId}`);

    const chats = await Chat.find({
      restaurantId: restaurantId,
      customerPhone: phone
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${chats.length} chats`);

    res.status(200).json({
      success: true,
      data: chats
    });
  } catch (error) {
    console.error("❌ Get Chat By Customer Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Admin Send Message
// ======================
exports.sendMessage = async (req, res) => {
  try {
    const { customerPhone, customerName, message } = req.body;
    const restaurantId = req.admin.restaurantId;

    if (!customerPhone || !message) {
      return res.status(400).json({
        success: false,
        message: "customerPhone and message are required"
      });
    }

    const chat = await Chat.create({
      restaurantId: restaurantId,
      customerId: `cust_${customerPhone}`,
      customerPhone,
      customerName: customerName || "Customer",
      customerMessage: "",
      botReply: message,
      sender: "admin",
      direction: "admin_to_customer",
      source: "admin_panel",
      messageId: null
    });

    const io = req.app.get("io");

    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: customerPhone,
        customerMessage: "",
        botReply: message,
        timestamp: chat.createdAt,
        isBot: false,
        chatId: chat._id
      });
    }

    res.status(201).json({
      success: true,
      data: chat
    });

  } catch (error) {
    console.error("❌ Send Message Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// WhatsApp Bot Save (n8n)
// ======================
exports.saveWhatsAppBotMessage = async (req, res) => {
  try {
    console.log("📨 WHATSAPP MESSAGE RECEIVED:", req.body);

    const {
      fromNumber,
      customerMessage = "",
      botReply = "",
      restaurantId = "restaurant-1"
    } = req.body;

    if (!fromNumber) {
      return res.status(400).json({
        success: false,
        message: "fromNumber is required"
      });
    }

    if (!customerMessage && !botReply) {
      return res.status(400).json({
        success: false,
        message: "Message cannot be empty"
      });
    }

    const chat = await Chat.create({
      restaurantId,
      customerId: `cust_${fromNumber}`,
      customerPhone: fromNumber,
      customerName: "WhatsApp Customer",
      customerMessage,
      botReply,
      sender: botReply ? "bot" : "customer",
      direction: botReply ? "bot_to_customer" : "customer_to_bot",
      source: "whatsapp_ai_bot",
      messageId: null
    });

    console.log("✅ Chat saved to DB:", chat._id);

    const io = req.app.get("io");

    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: fromNumber,
        customerMessage,
        botReply,
        timestamp: chat.createdAt,
        isBot: !!botReply,
        chatId: chat._id
      });
    }

    res.status(201).json({
      success: true,
      message: "WhatsApp message saved",
      data: chat
    });

  } catch (error) {
    console.error("❌ Save WhatsApp Message Error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate message detected"
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};