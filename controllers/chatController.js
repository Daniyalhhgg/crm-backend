// controllers/chatController.js
const Chat = require("../models/Chat");
const { getIO } = require("../realtime/socket");

const getPhoneLookupValues = (phone) => {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith("92") && digits.length === 12) {
    variants.add(`0${digits.slice(2)}`);
    variants.add(`00${digits}`);
  } else if (digits.startsWith("0") && digits.length === 11) {
    variants.add(`92${digits.slice(1)}`);
    variants.add(`0092${digits.slice(1)}`);
  } else if (digits.length === 10 && digits.startsWith("3")) {
    variants.add(`0${digits}`);
    variants.add(`92${digits}`);
    variants.add(`0092${digits}`);
  }

  const values = [...variants];
  const formattedValues = values.map((value) => new RegExp(
    `^\\D*${value.split("").join("\\D*")}\\D*$`
  ));
  return [...values, ...formattedValues];
};

// ==================== SEND MESSAGE ====================
exports.sendMessage = async (req, res) => {
  try {
    const { customerPhone, customerName, message } = req.body;
    const restaurantId = req.admin.restaurantId;

    if (!customerPhone || !message) {
      return res.status(400).json({
        success: false,
        message: "customerPhone and message are required",
      });
    }

    console.log(`
╔════════════════════════════════════════════╗
║      Admin Sending Message                ║
╠════════════════════════════════════════════╣
║ To: ${customerPhone}
║ Name: ${customerName || "Unknown"}
║ Message: ${message}
╚════════════════════════════════════════════╝
    `);

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
      messageId: null,
    });

    console.log(`✅ Message saved: ${chat._id}`);

    // ✅ REAL-TIME EMISSION
    try {
      const io = getIO();

      // CORRECT: "whatsapp-new-message" (dash, lowercase)
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: customerPhone,
        customerMessage: "",
        botReply: message,
        customerName: customerName || "Customer",
        timestamp: chat.createdAt,
        isBot: false,
        chatId: chat._id,
      });

      console.log(`✅ Emitted to chat-admins: whatsapp-new-message`);
    } catch (socketErr) {
      console.warn("⚠️  Socket emission failed:", socketErr.message);
    }

    res.status(201).json({
      success: true,
      data: chat,
    });

  } catch (error) {
    console.error("❌ Send Message Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET ALL CHATS ====================
exports.getAllChats = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`📥 Getting all chats for: ${restaurantId}`);

    const query = Chat.find({ restaurantId: restaurantId }).sort({
      createdAt: -1,
    });
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 5000)
      : 0;
    if (limit) query.limit(limit);
    const chats = await query;

    console.log(`✅ Found ${chats.length} chats`);

    res.status(200).json({
      success: true,
      data: chats,
      count: chats.length,
    });
  } catch (error) {
    console.error("❌ Get All Chats Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET CHAT BY CUSTOMER ====================
exports.getChatByCustomer = async (req, res) => {
  try {
    const { phone } = req.params;
    const customerId = String(req.query.customerId || "").trim();
    const restaurantId = req.admin.restaurantId;
    const phoneLookupValues = getPhoneLookupValues(phone);
    const customerIdLookupValues = customerId
      ? [...new Set([customerId, customerId.replace(/^cust_/, ""), `cust_${customerId.replace(/^cust_/, "")}`])]
      : [];
    const chatLookup = [
      ...(phoneLookupValues.length ? [{ customerPhone: { $in: phoneLookupValues } }] : []),
      ...(customerIdLookupValues.length ? [{ customerId: { $in: customerIdLookupValues } }] : []),
    ];
    if (!chatLookup.length) {
      return res.status(400).json({ success: false, message: "A valid phone or customerId is required" });
    }

    console.log(`📥 Getting chats for: ${phone}`);

    const chats = await Chat.find({
      restaurantId: restaurantId,
      $or: chatLookup,
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${chats.length} chats`);

    res.status(200).json({
      success: true,
      data: chats,
    });
  } catch (error) {
    console.error("❌ Get Chat By Customer Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== SAVE WHATSAPP MESSAGE ====================
exports.saveWhatsAppBotMessage = async (req, res) => {
  try {
    console.log("📨 WhatsApp Bot Message Received");

    const {
      fromNumber,
      customerMessage = "",
      botReply = "",
      restaurantId = "restaurant-1",
    } = req.body;

    if (!fromNumber) {
      return res.status(400).json({
        success: false,
        message: "fromNumber is required",
      });
    }

    if (!customerMessage && !botReply) {
      return res.status(400).json({
        success: false,
        message: "Message cannot be empty",
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
      messageId: null,
    });

    console.log(`✅ Chat saved: ${chat._id}`);

    // ✅ REAL-TIME EMISSION
    try {
      const io = getIO();

      // CORRECT: "whatsapp-new-message" (dash, lowercase)
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: fromNumber,
        customerMessage: customerMessage,
        botReply: botReply,
        customerName: "WhatsApp Customer",
        timestamp: chat.createdAt,
        isBot: !!botReply,
        chatId: chat._id,
      });

      console.log(`✅ Emitted to chat-admins: whatsapp-new-message`);
    } catch (socketErr) {
      console.warn("⚠️  Socket emission failed:", socketErr.message);
    }

    res.status(201).json({
      success: true,
      message: "WhatsApp message saved",
      data: chat,
    });

  } catch (error) {
    console.error("❌ Save WhatsApp Message Error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate message detected",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};