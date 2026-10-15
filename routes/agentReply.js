const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Chat = require("../models/Chat");
const Reminder = require("../models/Reminder");
const auth = require("../middleware/auth");
const { cancelJob, scheduleJob } = require("../services/reminderQueue");
const { generateMistralReply, sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/reminderAutoReply");

router.use(auth);

router.post("/reply", async (req, res) => {
  let linkedReminder;
  try {
    const { toPhone, message, customerName, reminderId } = req.body;
    const phone = String(toPhone || "").replace(/\D/g, "");
    const text = String(message || "").trim();
    if (!/^\d{10,15}$/.test(phone) || !text || text.length > 1000) {
      return res.status(400).json({ success: false, error: "Enter a valid WhatsApp number and a message up to 1,000 characters." });
    }

    if (reminderId) {
      if (!mongoose.isValidObjectId(reminderId)) return res.status(400).json({ success: false, error: "Invalid reminder id." });
      linkedReminder = await Reminder.findOneAndUpdate(
        { _id: reminderId, restaurantId: req.admin.restaurantId, fromNumber: phone, status: "pending" },
        { $set: { status: "sending", lastError: "" } },
        { new: true }
      );
      if (!linkedReminder) return res.status(409).json({ success: false, error: "This reminder is no longer pending or is already being sent." });
      await cancelJob(linkedReminder.jobId);
    }

    let delivery;
    try {
      delivery = await sendWhatsAppMessage(phone, text);
    } catch (error) {
      if (error.response?.data?.error?.code === 131047 && process.env.WHATSAPP_REMINDER_TEMPLATE_NAME) {
        delivery = await sendWhatsAppTemplate(phone, text);
      } else {
        if (linkedReminder) {
          const retryJob = await scheduleJob(linkedReminder._id, linkedReminder.reminderAt);
          linkedReminder.status = "pending";
          linkedReminder.lastError = String(error.message || error).slice(0, 500);
          linkedReminder.jobId = String(retryJob.id);
          await linkedReminder.save();
        }
        throw error;
      }
    }

    if (linkedReminder) {
      linkedReminder.status = "sent";
      linkedReminder.completedAt = new Date();
      linkedReminder.autoReplySent = true;
      linkedReminder.autoReplyMessage = text;
      linkedReminder.lastError = "";
      await linkedReminder.save();
    }

    try {
      await Chat.create({
        restaurantId: req.admin.restaurantId,
        customerPhone: phone,
        customerName: String(customerName || "WhatsApp Customer").trim(),
        botReply: text,
        sender: "admin",
        direction: "admin_to_customer",
        source: "human_agent",
        status: "sent",
        metadata: { whatsappMessageId: delivery?.messages?.[0]?.id || "", ...(reminderId ? { reminderId } : {}) },
      });
    } catch (historyError) {
      console.error("[AgentReply] Message sent but chat history save failed:", historyError.message);
    }

    const io = require("../realtime/socket").getIO();
    if (io) io.to("chat-admins").emit("whatsapp-new-message", {
      phone,
      botReply: text,
      isBot: false,
      sender: "admin",
      timestamp: new Date(),
      restaurantId: req.admin.restaurantId,
    });
    if (linkedReminder && io) io.to("chat-admins").emit("reminder:updated", {
      id: String(linkedReminder._id),
      status: "sent",
      reminder: linkedReminder,
      restaurantId: linkedReminder.restaurantId,
    });

    return res.json({ success: true, message: "Sent successfully" });
  } catch (error) {
    if (linkedReminder && linkedReminder.status === "sending") {
      linkedReminder.lastError = String(error.message || error).slice(0, 500);
      try {
        const retryJob = await scheduleJob(linkedReminder._id, linkedReminder.reminderAt);
        linkedReminder.status = "pending";
        linkedReminder.jobId = String(retryJob.id);
        await linkedReminder.save();
      } catch (scheduleError) {
        linkedReminder.status = "failed";
        linkedReminder.lastError = `${linkedReminder.lastError}; retry scheduling failed: ${scheduleError.message}`.slice(0, 500);
        await linkedReminder.save();
      }
    }
    console.error("[AgentReply] Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message,
    });
  }
});

router.post("/suggest", async (req, res) => {
  try {
    const { reason, customerName, customerMessage } = req.body;
    const suggestion = await generateMistralReply(reason, customerMessage, customerName);
    return res.json({ success: true, suggestion });
  } catch (error) {
    console.error("[AgentSuggest] Error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
