const Setting = require("../models/Setting");

const getPakistanDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Karachi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

exports.getServiceClosures = async (req, res) => {
  try {
    const setting = await Setting.findOne({ restaurantId: req.admin.restaurantId }).lean();
    const closures = (setting?.serviceClosures || [])
      .filter((closure) => closure.date >= getPakistanDate())
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json({ success: true, data: closures });
  } catch (error) {
    console.error("getServiceClosures error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicServiceClosures = async (req, res) => {
  try {
    if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const restaurantId = String(req.query.restaurantId || "").trim();
    if (!restaurantId) return res.status(400).json({ success: false, message: "restaurantId is required" });

    const setting = await Setting.findOne({ restaurantId }).lean();
    const closures = (setting?.serviceClosures || [])
      .filter((closure) => closure.date >= getPakistanDate())
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json({ success: true, data: { today: getPakistanDate(), closures } });
  } catch (error) {
    console.error("getPublicServiceClosures error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertServiceClosure = async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!isValidDate(date)) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date" });
    if (date < getPakistanDate()) return res.status(400).json({ success: false, message: "Past dates cannot be closed" });
    if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
      return res.status(400).json({ success: false, message: "A closure reason of 1 to 500 characters is required" });
    }

    const restaurantId = req.admin.restaurantId;
    const setting = await Setting.findOneAndUpdate(
      { restaurantId },
      { $setOnInsert: { restaurantId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const existing = setting.serviceClosures.find((closure) => closure.date === date);
    if (existing) {
      existing.reason = reason.trim();
      existing.updatedAt = new Date();
    } else {
      setting.serviceClosures.push({ date, reason: reason.trim(), updatedAt: new Date() });
    }
    await setting.save();

    const closure = setting.serviceClosures.find((item) => item.date === date);
    res.json({ success: true, data: closure });
  } catch (error) {
    console.error("upsertServiceClosure error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteServiceClosure = async (req, res) => {
  try {
    const { date } = req.params;
    if (!isValidDate(date)) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date" });
    const setting = await Setting.findOne({ restaurantId: req.admin.restaurantId });
    if (!setting) return res.status(404).json({ success: false, message: "Closure not found" });
    const index = setting.serviceClosures.findIndex((closure) => closure.date === date);
    if (index < 0) return res.status(404).json({ success: false, message: "Closure not found" });
    setting.serviceClosures.splice(index, 1);
    await setting.save();
    res.json({ success: true, data: { date } });
  } catch (error) {
    console.error("deleteServiceClosure error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
