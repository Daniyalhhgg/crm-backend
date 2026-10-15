const Queue = require("bull");
const Reminder = require("../models/Reminder");
const { fireReminderAutoReply } = require("./reminderAutoReply");

function redisOptions() {
  if (!process.env.REDIS_URL) {
    return { host: process.env.REDIS_HOST || "127.0.0.1", port: Number(process.env.REDIS_PORT) || 6379 };
  }
  const url = new URL(process.env.REDIS_URL);
  const database = url.pathname.slice(1);
  return {
    host: url.hostname,
    port: Number(url.port) || (url.protocol === "rediss:" ? 6380 : 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(database ? { db: Number(database) || 0 } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

const reminderQueue = new Queue("reminders", { redis: redisOptions() });

function emitReminderUpdate(reminder, status) {
  try {
    const { getIO } = require("../realtime/socket");
    const room = "chat-admins";
    getIO().to(room).emit("reminder:updated", {
      id: String(reminder._id),
      restaurantId: reminder.restaurantId,
      status,
      reminder,
    });
    if (status === "sent") {
      getIO().to(room).emit("reminder:fire", {
        id: String(reminder._id),
        restaurantId: reminder.restaurantId,
        fromNumber: reminder.fromNumber,
        customerName: reminder.customerName,
        reason: reminder.reason,
        customerMessage: reminder.customerMessage,
      });
    }
  } catch (error) {
    console.warn("[Queue] Reminder socket update failed:", error.message);
  }
}

reminderQueue.process(async (job) => {
  const reminder = await Reminder.findOneAndUpdate(
    { _id: job.data.reminderId, status: "pending" },
    { $set: { status: "sending", lastError: "" } },
    { new: true }
  );
  if (!reminder) {
    console.log(`[Queue] Skipping reminder ${job.data.reminderId}; it is missing or no longer pending.`);
    return;
  }

  try {
    const result = await fireReminderAutoReply(reminder);
    if (!result.success) throw new Error(result.error || "WhatsApp reminder could not be sent");

    reminder.status = "sent";
    reminder.completedAt = new Date();
    reminder.autoReplySent = true;
    reminder.autoReplyMessage = result.message;
    reminder.lastError = "";
    await reminder.save();
    try {
      await require("../models/Chat").create({
        restaurantId: reminder.restaurantId,
        customerPhone: reminder.fromNumber,
        customerName: reminder.customerName || "WhatsApp Customer",
        botReply: result.message,
        sender: "bot",
        direction: "bot_to_customer",
        source: "scheduled_reminder",
        status: "sent",
        isBookingRelated: Boolean(reminder.bookingId),
        bookingId: reminder.bookingId || null,
        metadata: { reminderId: String(reminder._id), whatsappMessageId: result.messageId || "" },
      });
    } catch (error) {
      console.error("[Queue] Reminder was sent, but chat history could not be saved:", error.message);
    }
    emitReminderUpdate(reminder, "sent");
    console.log(`[Queue] Reminder sent: ${reminder._id}`);
  } catch (error) {
    reminder.status = "pending";
    reminder.lastError = String(error.message || error).slice(0, 500);
    await reminder.save();
    throw error;
  }
});

reminderQueue.on("failed", (job, error) => {
  if (!job || job.attemptsMade < Number(job.opts.attempts || 1)) return;
  Reminder.findOneAndUpdate(
    { _id: job.data.reminderId, status: "pending" },
    { $set: { status: "failed", lastError: String(error.message || error).slice(0, 500) } },
    { new: true }
  ).then((reminder) => {
    if (reminder) emitReminderUpdate(reminder, "failed");
  }).catch((updateError) => {
    console.error("[Queue] Could not mark reminder failed:", updateError.message);
  });
});

async function scheduleJob(reminderId, reminderAt) {
  const delay = new Date(reminderAt) - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) throw new Error("Reminder time must be in the future");

  return reminderQueue.add(
    { reminderId: reminderId.toString() },
    { delay, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true }
  );
}

async function cancelJob(jobId) {
  if (!jobId) return;
  const job = await reminderQueue.getJob(jobId);
  if (job) await job.remove();
}

async function restorePendingReminders() {
  const reminders = await Reminder.find({ status: "pending" }).select("_id reminderAt jobId").lean();
  for (const reminder of reminders) {
    const existing = reminder.jobId ? await reminderQueue.getJob(reminder.jobId) : null;
    if (existing) continue;
    if (!reminder.reminderAt || new Date(reminder.reminderAt) <= new Date()) {
      await Reminder.updateOne(
        { _id: reminder._id, status: "pending" },
        { $set: { status: "failed", lastError: "Scheduled time elapsed while no queue job was available." } }
      );
      continue;
    }
    const job = await scheduleJob(reminder._id, reminder.reminderAt);
    await Reminder.updateOne({ _id: reminder._id }, { $set: { jobId: String(job.id) } });
  }
}

module.exports = { scheduleJob, cancelJob, restorePendingReminders, reminderQueue };
