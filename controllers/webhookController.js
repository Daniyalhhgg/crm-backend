// controllers/webhookController.js
const Chat = require("../models/Chat");
const Booking = require("../models/Booking");
const { getIO } = require("../realtime/socket");
const { publishDashboardNotification } = require("../services/dashboardNotificationService");

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
      isHumanHandover = false,
    } = req.body;

    console.log(`
╔════════════════════════════════════════════╗
║     📨 WhatsApp Webhook Received          ║
╠════════════════════════════════════════════╣
║ Type: ${eventType}
║ From: ${fromNumber}
║ Message: ${customerMessage || botReply || "(no text)"}
╚════════════════════════════════════════════╝
    `);

    if (!fromNumber) {
      return res.status(400).json({
        success: false,
        message: "fromNumber is required",
      });
    }

    let io;
    try {
      io = getIO();
    } catch (err) {
      console.warn("⚠️  Socket.io not ready:", err.message);
    }

    // ==================== 1. SAVE CHAT MESSAGE ====================
    const chatMessage = await Chat.create({
      phone: fromNumber,
      customerMsg: customerMessage,
      botReply: botReply,
      direction: botReply ? "bot_to_customer" : "customer_to_bot",
      timestamp: timestamp || new Date(),
      restaurantId,
      source: "whatsapp_ai_bot",
    });

    console.log(`✅ Chat saved to DB: ${chatMessage._id}`);

    // ==================== 2. EMIT TO ADMINS (REAL-TIME) ====================
    if (io) {
      const messageData = {
        phone: fromNumber,
        customerMessage: customerMessage,
        botReply: botReply,
        customerName: "WhatsApp Customer",
        timestamp: chatMessage.timestamp,
        isBot: !!botReply,
        chatId: chatMessage._id,
      };

      // ✅ CORRECT EVENT NAME: "whatsapp-new-message" (dash, lowercase)
      io.to("chat-admins").emit("whatsapp-new-message", messageData);
      console.log(`✅ Emitted to chat-admins: whatsapp-new-message`);
    } else {
      console.warn("⚠️  Socket.io not available");
    }

    // ==================== 3. HANDLE BOOKING ====================
    if (eventType === "new_booking" && bookingData) {
      let parsedData = bookingData;

      if (typeof bookingData === "string") {
        try {
          parsedData = JSON.parse(bookingData);
        } catch (e) {
          console.error("Failed to parse booking:", e);
          parsedData = {};
        }
      }

      const newBooking = await Booking.create({
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
        source: "whatsapp_ai_bot",
      });

      console.log(`✅ Booking saved to DB: ${newBooking._id}`);
      try {
        await publishDashboardNotification(req, {
          restaurantId,
          sourceKey: `new_booking:${newBooking._id}`,
          type: "new_booking",
          title: "New booking received",
          message: `${newBooking.customerName || "Customer"} · ${newBooking.package || "Booking"}`,
          entityType: "booking",
          entityId: String(newBooking._id),
        });
      } catch (notificationError) {
        console.error("New booking dashboard notification failed:", notificationError);
      }

      // ✅ Emit to admins
      if (io) {
        // CORRECT EVENT NAME: "new-booking" (dash, lowercase)
        io.to("chat-admins").emit("new-booking", {
          type: "NEW_BOOKING",
          booking: newBooking,
          timestamp: new Date(),
        });

        console.log(`✅ Emitted to chat-admins: new-booking`);
      }
    }

    // ==================== 4. HUMAN HANDOVER ====================
    if (isHumanHandover && io) {
      // CORRECT EVENT NAME: "human-handover-request"
      io.to("chat-admins").emit("human-handover-request", {
        phone: fromNumber,
        customerMessage: customerMessage,
        timestamp: new Date(),
      });

      console.log(`✅ Emitted to chat-admins: human-handover-request`);
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      chatSaved: true,
      bookingSaved: eventType === "new_booking",
    });

  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};