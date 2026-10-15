const Booking = require("../models/Booking");
const Setting = require("../models/Setting");
const Menu = require("../models/Menu");
const MENU_CATEGORIES = require("../config/menuCategories");
const menuCategoryForPackage = require("../utils/menuCategory");

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");
const ordinal = (number) => {
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  return `${number}${({ 1: "st", 2: "nd", 3: "rd" })[number % 10] || "th"}`;
};

exports.getLoyalty = async (req, res) => {
  try {
    if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const phone = normalizePhone(req.params.phone);
    const restaurantId = req.query.restaurantId || "restaurant-1";
    const category = req.query.category;
    if (phone.length < 7 || phone.length > 15) return res.status(400).json({ success: false, message: "A valid customer phone number is required" });
    if (category && !MENU_CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: "Invalid menu category" });
    const [settings, menu, matchingBookings] = await Promise.all([
      Setting.findOne({ restaurantId }).lean(),
      category ? Menu.findOne({ restaurantId, category }).lean() : null,
      Booking.find({ restaurantId, status: { $in: ["checked_in", "completed"] } }).select("customerPhone package").lean(),
    ]);
    const config = menu?.loyalty || settings?.loyalty || { enabled: true, visitsForReward: 5, rewardText: "Chef Special Dessert" };
    const visitCount = matchingBookings.filter((booking) =>
      normalizePhone(booking.customerPhone) === phone &&
      (!category || menuCategoryForPackage(booking.package) === category)
    ).length;
    const visitsForReward = config.visitsForReward || 5;
    const rewardEarned = Boolean(config.enabled && visitCount > 0 && visitCount % visitsForReward === 0);
    const cycleVisits = visitCount % visitsForReward;
    const visitsRemaining = cycleVisits === 0 ? visitsForReward : visitsForReward - cycleVisits;
    let message = "";
    if (!config.enabled) message = "Loyalty rewards are currently unavailable.";
    else if (rewardEarned) message = `Congratulations! You have earned a FREE ${config.rewardText}. Your next reward cycle starts now.`;
    else if (visitCount > 0) message = `Thank you for your ${ordinal(visitCount)} visit to Hotel d'GATES. You are ${visitsRemaining} more ${visitsRemaining === 1 ? "visit" : "visits"} away to enjoy '${config.rewardText}' for FREE.`;
    res.json({ success: true, data: { visitCount, visitsForReward, visitsRemaining, rewardText: config.rewardText, rewardEarned, enabled: config.enabled, message } });
  } catch (error) {
    console.error("getLoyalty error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLoyaltySettings = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const setting = await Setting.findOneAndUpdate(
      { restaurantId },
      { $setOnInsert: { restaurantId, loyalty: { enabled: true, visitsForReward: 5, rewardText: "Chef Special Dessert" } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: setting.loyalty });
  } catch (error) {
    console.error("getLoyaltySettings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLoyaltySettings = async (req, res) => {
  try {
    const { enabled, visitsForReward, rewardText } = req.body;
    if (enabled !== undefined && typeof enabled !== "boolean") return res.status(400).json({ success: false, message: "enabled must be a boolean" });
    if (visitsForReward !== undefined && (!Number.isInteger(Number(visitsForReward)) || Number(visitsForReward) < 1 || Number(visitsForReward) > 100)) {
      return res.status(400).json({ success: false, message: "visitsForReward must be an integer from 1 to 100" });
    }
    if (rewardText !== undefined && (typeof rewardText !== "string" || !rewardText.trim() || rewardText.length > 160)) {
      return res.status(400).json({ success: false, message: "rewardText is required and must be 160 characters or fewer" });
    }
    const loyalty = {};
    if (enabled !== undefined) loyalty["loyalty.enabled"] = enabled;
    if (visitsForReward !== undefined) loyalty["loyalty.visitsForReward"] = Number(visitsForReward);
    if (rewardText !== undefined) loyalty["loyalty.rewardText"] = rewardText.trim();
    const setting = await Setting.findOneAndUpdate(
      { restaurantId: req.admin.restaurantId },
      { $set: loyalty, $setOnInsert: { restaurantId: req.admin.restaurantId } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    const io = req.app.get("io");
    if (io) io.to("chat-admins").emit("loyalty_settings_updated", { restaurantId: req.admin.restaurantId, loyalty: setting.loyalty });
    res.json({ success: true, data: setting.loyalty });
  } catch (error) {
    console.error("updateLoyaltySettings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
