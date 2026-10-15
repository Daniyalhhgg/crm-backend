const mongoose = require("mongoose");
const DashboardNotification = require("../models/DashboardNotification");
const { publishDashboardNotification } = require("../services/dashboardNotificationService");

exports.getNotifications = async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;
    const [notifications, unreadCount] = await Promise.all([
      DashboardNotification.find({ restaurantId: req.admin.restaurantId }).sort({ createdAt: -1 }).limit(limit).lean(),
      DashboardNotification.countDocuments({ restaurantId: req.admin.restaurantId, readAt: null }),
    ]);
    res.json({ success: true, data: notifications, unreadCount });
  } catch (error) {
    console.error("getDashboardNotifications error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid notification id." });
    }
    const notification = await DashboardNotification.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.admin.restaurantId, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) {
      const existing = await DashboardNotification.exists({ _id: req.params.id, restaurantId: req.admin.restaurantId });
      if (!existing) return res.status(404).json({ success: false, message: "Notification not found." });
      return res.json({ success: true, message: "Notification was already read." });
    }
    res.json({ success: true, data: notification });
  } catch (error) {
    console.error("markDashboardNotificationRead error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    await DashboardNotification.updateMany(
      { restaurantId: req.admin.restaurantId, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error("markAllDashboardNotificationsRead error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createHandoffNotification = async (req, res) => {
  try {
    const { sourceKey, phone, name = "", message = "", type = "human_agent" } = req.body || {};
    if (typeof sourceKey !== "string" || !sourceKey.trim() || sourceKey.length > 200) {
      return res.status(400).json({ success: false, message: "A valid sourceKey is required." });
    }
    if (typeof phone !== "string" || !phone.trim() || phone.length > 80) {
      return res.status(400).json({ success: false, message: "A valid customer phone is required." });
    }
    if (!["human_agent", "customer_frustrated"].includes(type)) {
      return res.status(400).json({ success: false, message: "Unsupported customer alert type." });
    }
    if (typeof name !== "string" || typeof message !== "string") {
      return res.status(400).json({ success: false, message: "Customer name and message must be strings." });
    }

    const notification = await publishDashboardNotification(req, {
      restaurantId: req.admin.restaurantId,
      sourceKey: `handoff:${sourceKey.trim()}`,
      type,
      title: type === "human_agent" ? "Customer needs a human agent" : "Customer may need follow-up",
      message: `${name.trim() ? `${name.trim()} · ` : ""}+${phone.trim()}${message.trim() ? `: ${message.trim().slice(0, 800)}` : ""}`,
      entityType: "customer",
      entityId: phone.trim(),
    });
    res.status(201).json({ success: true, data: notification, duplicate: !notification });
  } catch (error) {
    console.error("createHandoffDashboardNotification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
