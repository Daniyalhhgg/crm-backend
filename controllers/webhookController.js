// controllers/webhookController.js
const Chat = require("../models/Chat");
const Booking = require("../models/Booking");
const { getIO } = require("../realtime/socket");

exports.handleWhatsAppWebhook = async (req, res) => {
  try {
    const {
      eventType = "new_message",
      fromNumber,
      customerMessage = "",
      botReply = "",
      timestamp,
      restaurantId = "restaurant-1",
      bookingData,
      isHumanHandover = false
    } = req.body;

    if (!fromNumber) {
      return res.status(400).json({ 
        success: false, 
        message: "fromNumber is required" 
      });
    }

    // Safe way to get Socket.io
    let io;
    try {
      io = getIO();
    } catch (socketErr) {
      console.warn("Socket.io not initialized yet:", socketErr.message);
      // اگر socket ابھی ready نہیں تو بھی continue کریں
    }

    // ==================== 1. SAVE CHAT MESSAGE ====================
    const chatMessage = await Chat.create({
      phone: fromNumber,
      customerMsg: customerMessage,
      botReply: botReply,
      direction: botReply ? "bot_to_customer" : "customer_to_bot",
      timestamp: timestamp || new Date(),
      restaurantId,
      source: "whatsapp_ai_bot"
    });

    // Real-time Chat Update
    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: fromNumber,
        customerMessage,
        botReply,
        timestamp: chatMessage.timestamp,
        isBot: !!botReply,
        chatId: chatMessage._id
      });
    }

    // ==================== 2. BOOKING HANDLE ====================
    let newBooking = null;

    if (eventType === "new_booking" && bookingData) {
      let parsedData = bookingData;

      if (typeof bookingData === "string") {
        try {
          parsedData = JSON.parse(bookingData);
        } catch (e) {
          console.error("Failed to parse booking JSON from n8n:", e);
        }
      }

      newBooking = await Booking.create({
        customerName: parsedData.customer?.name || "WhatsApp Customer",
        customerPhone: parsedData.customer?.phone || fromNumber,
        customerEmail: parsedData.customer?.email || "",
        package: parsedData.order?.package || "",
        numberOfPersons: Number(parsedData.order?.persons) || 1,
        bookingDate: parsedData.order?.date || "",
        bookingTime: parsedData.order?.time || "",
        specialRequest: parsedData.order?.special_request || "",
        restaurantId,
        status: "pending",
        source: "whatsapp_ai_bot"
      });

      // Real-time Booking Update
      if (io) {
        io.to("chat-admins").emit("new-booking-from-whatsapp", {
          type: "new-booking",
          booking: newBooking
        });

        // آپ کے bookingController کے مطابق بھی emit کریں
        io.emit("new_booking", {
          type: "NEW_BOOKING",
          data: newBooking
        });
      }
    }

    // ==================== 3. HUMAN HANDOVER NOTIFICATION ====================
    if (isHumanHandover && io) {
      io.to("chat-admins").emit("human-handover-request", {
        phone: fromNumber,
        customerMessage,
        timestamp: new Date()
      });
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      chatSaved: true,
      bookingCreated: !!newBooking
    });

  } catch (error) {
    console.error("WhatsApp Webhook Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};