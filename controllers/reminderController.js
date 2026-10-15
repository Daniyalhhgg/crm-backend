const mongoose = require("mongoose");
const Reminder = require("../models/Reminder");
const Setting = require("../models/Setting");
const Chat = require("../models/Chat");
const { parseReminderDateTime } = require("../utils/dateParser");
const { scheduleJob, cancelJob } = require("../services/reminderQueue");

const REASONS = new Set(["payment_pending", "booking_later", "visit_later", "general"]);
const STATUSES = new Set(["pending", "sent", "completed", "cancelled", "failed"]);
const TIME_ZONE = "Asia/Karachi";
const DEFAULT_FOLLOW_UP_DELAY_MINUTES = 24 * 60;
const MAX_FOLLOW_UP_DELAY_MINUTES = 30 * 24 * 60;

function delayLabel(minutes) {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} day${minutes === 24 * 60 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
function delayFromReminder(reminder) {
  if (!reminder.customerWindowExpiresAt || !reminder.reminderAt) return null;
  const receivedAt = new Date(reminder.customerWindowExpiresAt).getTime() - 24 * 60 * 60 * 1000;
  return Math.round((new Date(reminder.reminderAt).getTime() - receivedAt) / 60000);
}
function assertDeliveryConfigured({ reminderAt, customerWindowExpiresAt }) {
  const missing = [];
  if (!process.env.MISTRAL_API_KEY) missing.push("MISTRAL_API_KEY");
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN)) missing.push("WHATSAPP_ACCESS_TOKEN");
  const requiresTemplate = !customerWindowExpiresAt || reminderAt >= customerWindowExpiresAt;
  if (requiresTemplate && !process.env.WHATSAPP_REMINDER_TEMPLATE_NAME) missing.push("WHATSAPP_REMINDER_TEMPLATE_NAME (required when the reminder is outside the 24-hour WhatsApp window)");
  if (missing.length) throw Object.assign(new Error(`Scheduled WhatsApp reminders are not configured: ${missing.join(", ")}.`), { status: 503 });
}

function safeParse(reminderDate, reminderTime) {
  const parsed = parseReminderDateTime(reminderDate, reminderTime);
  if (Number.isNaN(parsed.getTime())) throw new Error("Could not parse the reminder date and time");
  return parsed;
}

function localDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const hour = value("hour") === "24" ? "00" : value("hour");
  return {
    reminderDate: `${value("year")}-${value("month")}-${value("day")}`,
    reminderTime: `${hour}:${value("minute")}`,
  };
}

function emitReminder(event, reminder) {
  const io = require("../realtime/socket").getIO();
  if (!io) return;
  io.to("chat-admins").emit(event, {
    id: String(reminder._id),
    reminder,
    status: reminder.status,
    restaurantId: reminder.restaurantId,
  });
}

function normalizedPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function createScheduledReminder({ data, restaurantId, source, sourceMessageId }) {
  const fromNumber = normalizedPhone(data.fromNumber);
  if (!/^\d{10,15}$/.test(fromNumber)) throw Object.assign(new Error("A valid WhatsApp number with country code is required."), { status: 400 });
  if (!REASONS.has(data.reason)) throw Object.assign(new Error("A valid reminder reason is required."), { status: 400 });

  let reminderAt;
  let reminderDate;
  let reminderTime;
  let customerWindowExpiresAt = null;
  let effectiveDelayMinutes = null;
  if (source === "whatsapp_bot") {
    const receivedAt = data.receivedAt ? new Date(data.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime()) || receivedAt > new Date(Date.now() + 60_000)) {
      throw Object.assign(new Error("WhatsApp message timestamp is invalid."), { status: 400 });
    }
    const setting = await Setting.findOne({ restaurantId }).select("followUpReminderDelayMinutes").lean();
    effectiveDelayMinutes = Number(setting?.followUpReminderDelayMinutes) || DEFAULT_FOLLOW_UP_DELAY_MINUTES;
    reminderAt = new Date(receivedAt.getTime() + effectiveDelayMinutes * 60 * 1000);
    customerWindowExpiresAt = new Date(receivedAt.getTime() + 24 * 60 * 60 * 1000);
    ({ reminderDate, reminderTime } = localDateTime(reminderAt));
  } else {
    reminderDate = data.reminderDate;
    reminderTime = data.reminderTime;
    try {
      reminderAt = safeParse(reminderDate, reminderTime);
    } catch (error) {
      throw Object.assign(new Error(`Invalid reminder date/time: ${error.message}`), { status: 400 });
    }
  }

  if (reminderAt <= new Date()) {
    throw Object.assign(new Error("Reminder time must be in the future."), { status: 400 });
  }
  if (source === "manual") {
    const latestInbound = await Chat.findOne({
      restaurantId,
      customerPhone: fromNumber,
      $or: [{ sender: "customer" }, { direction: "customer_to_bot" }],
    }).sort({ createdAt: -1 }).select("createdAt").lean();
    if (latestInbound?.createdAt) customerWindowExpiresAt = new Date(new Date(latestInbound.createdAt).getTime() + 24 * 60 * 60 * 1000);
  }
  try {
    assertDeliveryConfigured({ reminderAt, customerWindowExpiresAt });
  } catch (error) {
    throw Object.assign(error, { status: 503 });
  }
  if (sourceMessageId) {
    const existing = await Reminder.findOne({ restaurantId, sourceMessageId });
    if (existing) return { reminder: existing, duplicate: true, delayMinutes: delayFromReminder(existing) };
  }
  let reminder;
  try {
    reminder = await Reminder.create({
      fromNumber,
      restaurantId,
      bookingId: mongoose.isValidObjectId(data.bookingId) ? data.bookingId : null,
      customerName: String(data.customerName || "").trim().slice(0, 120),
      reason: data.reason,
      reminderDate,
      reminderTime,
      reminderAt,
      customerWindowExpiresAt,
      customerMessage: String(data.customerMessage || "").trim().slice(0, 2000),
      source,
      ...(sourceMessageId ? { sourceMessageId } : {}),
    });
  } catch (error) {
    if (error.code === 11000 && sourceMessageId) {
      const existing = await Reminder.findOne({ restaurantId, sourceMessageId });
      if (existing) return { reminder: existing, duplicate: true, delayMinutes: delayFromReminder(existing) };
    }
    throw error;
  }

  try {
    const job = await scheduleJob(reminder._id, reminderAt);
    reminder.jobId = String(job.id);
    await reminder.save();
  } catch (error) {
    await Reminder.deleteOne({ _id: reminder._id });
    throw Object.assign(new Error(`Reminder could not be scheduled. Check the Redis queue connection. ${error.message}`), { status: 503 });
  }

  emitReminder("reminder:created", reminder);
  return { reminder, duplicate: false, delayMinutes: effectiveDelayMinutes };
}

async function createReminder(req, res) {
  try {
    const result = await createScheduledReminder({
      data: req.body,
      restaurantId: req.admin.restaurantId,
      source: "manual",
    });
    return res.status(201).json({
      success: true,
      reminder: result.reminder,
      duplicate: result.duplicate,
      scheduledFor: result.reminder.reminderAt,
      delayMinutes: result.delayMinutes,
      delayLabel: result.delayMinutes ? delayLabel(result.delayMinutes) : undefined,
    });
  } catch (error) {
    console.error("createReminder error:", error.message);
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}

async function createReminderFromWhatsApp(req, res) {
  const configuredKey = process.env.N8N_API_KEY;
  if (!configuredKey) return res.status(503).json({ success: false, error: "N8N_API_KEY is not configured." });
  if (req.get("x-api-key") !== configuredKey) return res.status(401).json({ success: false, error: "Invalid API key." });

  try {
    const { reminder, duplicate, delayMinutes } = await createScheduledReminder({
      data: req.body,
      restaurantId: String(req.body.restaurantId || "restaurant-1"),
      source: "whatsapp_bot",
      sourceMessageId: String(req.body.sourceMessageId || "").trim() || undefined,
    });
    return res.status(duplicate ? 200 : 201).json({
      success: true,
      reminderId: reminder._id,
      duplicate,
      scheduledFor: reminder.reminderAt,
      delayMinutes,
      delayLabel: delayMinutes ? delayLabel(delayMinutes) : undefined,
      reminder,
    });
  } catch (error) {
    console.error("createReminderFromWhatsApp error:", error.message);
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}

async function cancelRemindersAfterCustomerReply(req, res) {
  const configuredKey = process.env.N8N_API_KEY;
  if (!configuredKey) return res.status(503).json({ success: false, error: "N8N_API_KEY is not configured." });
  if (req.get("x-api-key") !== configuredKey) return res.status(401).json({ success: false, error: "Invalid API key." });

  try {
    const fromNumber = normalizedPhone(req.body.fromNumber);
    const restaurantId = String(req.body.restaurantId || "restaurant-1");
    if (!/^\d{10,15}$/.test(fromNumber)) return res.status(400).json({ success: false, error: "A valid WhatsApp number is required." });

    const pending = await Reminder.find({ restaurantId, fromNumber, status: "pending" }).select("_id jobId");
    let cancelled = 0;
    for (const reminder of pending) {
      const updated = await Reminder.findOneAndUpdate(
        { _id: reminder._id, status: "pending" },
        { $set: { status: "cancelled" } },
        { new: true }
      );
      if (!updated) continue;
      try {
        await cancelJob(reminder.jobId);
      } catch (error) {
        console.warn("Cancelled reminder job could not be removed; it will skip by status:", error.message);
      }
      emitReminder("reminder:updated", updated);
      cancelled += 1;
    }
    return res.json({ success: true, cancelled });
  } catch (error) {
    console.error("cancelRemindersAfterCustomerReply error:", error);
    return res.status(500).json({ success: false, error: "Could not update customer reminders." });
  }
}

async function getReminders(req, res) {
  try {
    const filter = { restaurantId: req.admin.restaurantId };
    if (req.query.status && req.query.status !== "all") {
      const statuses = String(req.query.status).split(",").filter((status) => STATUSES.has(status) || status === "sending");
      if (!statuses.length) return res.status(400).json({ success: false, error: "Invalid reminder status." });
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
    if (req.query.reason && req.query.reason !== "all") {
      if (!REASONS.has(req.query.reason)) return res.status(400).json({ success: false, error: "Invalid reminder reason." });
      filter.reason = req.query.reason;
    }

    const reminders = await Reminder.find(filter).sort({ createdAt: -1 }).limit(1000).lean();
    return res.json({ success: true, reminders });
  } catch (error) {
    console.error("getReminders error:", error);
    return res.status(500).json({ success: false, error: "Could not load reminders." });
  }
}

async function getReminderSettings(req, res) {
  try {
    const setting = await Setting.findOne({ restaurantId: req.admin.restaurantId }).select("followUpReminderDelayMinutes").lean();
    const delayMinutes = Number(setting?.followUpReminderDelayMinutes) || DEFAULT_FOLLOW_UP_DELAY_MINUTES;
    return res.json({ success: true, delayMinutes, delayLabel: delayLabel(delayMinutes), minMinutes: 1, maxMinutes: MAX_FOLLOW_UP_DELAY_MINUTES });
  } catch (error) {
    console.error("getReminderSettings error:", error);
    return res.status(500).json({ success: false, error: "Could not load follow-up settings." });
  }
}

async function updateReminderSettings(req, res) {
  try {
    const delayMinutes = Number(req.body.delayMinutes);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > MAX_FOLLOW_UP_DELAY_MINUTES) {
      return res.status(400).json({ success: false, error: `Follow-up delay must be a whole number between 1 and ${MAX_FOLLOW_UP_DELAY_MINUTES} minutes.` });
    }
    await Setting.updateOne(
      { restaurantId: req.admin.restaurantId },
      { $set: { followUpReminderDelayMinutes: delayMinutes }, $setOnInsert: { restaurantId: req.admin.restaurantId } },
      { upsert: true, runValidators: true }
    );
    return res.json({ success: true, delayMinutes, delayLabel: delayLabel(delayMinutes) });
  } catch (error) {
    console.error("updateReminderSettings error:", error);
    return res.status(500).json({ success: false, error: "Could not save follow-up settings." });
  }
}

async function updateStatus(req, res) {
  try {
    const { reminderId, status } = req.body;
    if (!mongoose.isValidObjectId(reminderId) || !STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: "A valid reminderId and status are required." });
    }
    const reminder = await Reminder.findOneAndUpdate(
      { _id: reminderId, restaurantId: req.admin.restaurantId },
      { $set: { status, ...(status === "sent" || status === "completed" ? { completedAt: new Date() } : {}) } },
      { new: true, runValidators: true }
    );
    if (!reminder) return res.status(404).json({ success: false, error: "Reminder not found." });
    if (["sent", "completed", "cancelled"].includes(status)) await cancelJob(reminder.jobId);
    emitReminder("reminder:updated", reminder);
    return res.json({ success: true, reminder });
  } catch (error) {
    console.error("updateStatus error:", error);
    return res.status(500).json({ success: false, error: "Could not update reminder status." });
  }
}

async function completeReminder(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid reminder id." });
    const reminder = await Reminder.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!reminder) return res.status(404).json({ success: false, error: "Reminder not found." });
    if (reminder.status === "sending") return res.status(409).json({ success: false, error: "This reminder is currently being sent." });
    await cancelJob(reminder.jobId);
    reminder.status = "completed";
    reminder.completedAt = new Date();
    await reminder.save();
    emitReminder("reminder:updated", reminder);
    return res.json({ success: true, reminder });
  } catch (error) {
    console.error("completeReminder error:", error);
    return res.status(500).json({ success: false, error: "Could not complete reminder." });
  }
}

async function rescheduleReminder(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid reminder id." });
    const reminder = await Reminder.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!reminder) return res.status(404).json({ success: false, error: "Reminder not found." });
    if (!["pending", "failed"].includes(reminder.status)) return res.status(409).json({ success: false, error: "Only pending or failed reminders can be rescheduled." });

    let reminderAt;
    try {
      reminderAt = safeParse(req.body.reminderDate, req.body.reminderTime);
    } catch (error) {
      return res.status(400).json({ success: false, error: `Invalid reminder date/time: ${error.message}` });
    }
    if (reminderAt <= new Date()) return res.status(400).json({ success: false, error: "New reminder time must be in the future." });

    const oldJobId = reminder.jobId;
    let newJob;
    try {
      newJob = await scheduleJob(reminder._id, reminderAt);
      reminder.reminderDate = req.body.reminderDate;
      reminder.reminderTime = req.body.reminderTime;
      reminder.reminderAt = reminderAt;
      reminder.jobId = String(newJob.id);
      reminder.status = "pending";
      reminder.lastError = "";
      reminder.completedAt = null;
      await reminder.save();
    } catch (error) {
      if (newJob?.id) await cancelJob(String(newJob.id));
      return res.status(503).json({ success: false, error: `Reminder could not be rescheduled: ${error.message}` });
    }

    await cancelJob(oldJobId);
    emitReminder("reminder:updated", reminder);
    return res.json({ success: true, reminder, scheduledFor: reminderAt });
  } catch (error) {
    console.error("rescheduleReminder error:", error);
    return res.status(500).json({ success: false, error: "Could not reschedule reminder." });
  }
}

async function deleteReminder(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid reminder id." });
    const reminder = await Reminder.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!reminder) return res.status(404).json({ success: false, error: "Reminder not found." });
    if (reminder.status === "sending") return res.status(409).json({ success: false, error: "This reminder is currently being sent." });
    await cancelJob(reminder.jobId);
    await reminder.deleteOne();
    emitReminder("reminder:deleted", reminder);
    return res.json({ success: true });
  } catch (error) {
    console.error("deleteReminder error:", error);
    return res.status(500).json({ success: false, error: "Could not delete reminder." });
  }
}

module.exports = {
  createReminder,
  createReminderFromWhatsApp,
  cancelRemindersAfterCustomerReply,
  getReminders,
  getReminderSettings,
  updateReminderSettings,
  updateStatus,
  completeReminder,
  rescheduleReminder,
  deleteReminder,
};
