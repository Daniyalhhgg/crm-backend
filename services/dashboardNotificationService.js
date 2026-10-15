const DashboardNotification = require("../models/DashboardNotification");

exports.publishDashboardNotification = async (req, data) => {
  const existing = await DashboardNotification.findOne({
    restaurantId: data.restaurantId,
    sourceKey: data.sourceKey,
  });
  if (existing) return existing;

  let notification;
  try {
    notification = await DashboardNotification.create(data);
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }

  const io = req.app.get("io");
  if (io) io.to("chat-admins").emit("dashboard-notification", notification.toObject());
  return notification;
};
