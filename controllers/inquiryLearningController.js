const mongoose = require("mongoose");
const InquiryLearning = require("../models/InquiryLearning");
const Chat = require("../models/Chat");

const MAX_PUBLIC_ITEMS = 200;

const requireN8nApiKey = (req, res) => {
  const expected = process.env.N8N_API_KEY;
  if (!expected) {
    res.status(503).json({ success: false, message: "Inquiry learning API is not configured: N8N_API_KEY is required." });
    return false;
  }
  if (req.get("x-api-key") !== expected) {
    res.status(401).json({ success: false, message: "Invalid API key." });
    return false;
  }
  return true;
};

const validateLearning = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  if (typeof body.question !== "string" || !body.question.trim() || body.question.trim().length > 1000) {
    return "question is required and must be 1000 characters or fewer.";
  }
  if (typeof body.answer !== "string" || !body.answer.trim() || body.answer.trim().length > 5000) {
    return "answer is required and must be 5000 characters or fewer.";
  }
  if (body.category !== undefined && (typeof body.category !== "string" || body.category.trim().length > 100)) {
    return "category must be 100 characters or fewer.";
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return "isActive must be a boolean.";
  }
  if (body.sourceChatId && !mongoose.isValidObjectId(body.sourceChatId)) {
    return "sourceChatId must be a valid chat id.";
  }
  return null;
};

exports.getLearningItems = async (req, res) => {
  try {
    const filter = { restaurantId: req.admin.restaurantId };
    if (req.query.active === "true") filter.isActive = true;
    if (req.query.active === "false") filter.isActive = false;
    const items = await InquiryLearning.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ success: true, data: items });
  } catch (error) {
    console.error("getLearningItems error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createLearningItem = async (req, res) => {
  try {
    const invalid = validateLearning(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const restaurantId = req.admin.restaurantId;
    if (req.body.sourceChatId) {
      const source = await Chat.exists({ _id: req.body.sourceChatId, restaurantId });
      if (!source) return res.status(404).json({ success: false, message: "Source inquiry was not found for this restaurant." });
    }
    const adminName = req.admin.name || req.admin.email || "CRM staff";
    const item = await InquiryLearning.create({
      restaurantId,
      question: req.body.question.trim(),
      answer: req.body.answer.trim(),
      category: String(req.body.category || "Other Questions").trim() || "Other Questions",
      sourceChatId: req.body.sourceChatId || null,
      isActive: req.body.isActive !== false,
      createdBy: adminName,
      updatedBy: adminName,
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error("createLearningItem error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLearningItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid learning item id." });
    const invalid = validateLearning(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    if (req.body.sourceChatId) {
      const source = await Chat.exists({ _id: req.body.sourceChatId, restaurantId: req.admin.restaurantId });
      if (!source) return res.status(404).json({ success: false, message: "Source inquiry was not found for this restaurant." });
    }

    const adminName = req.admin.name || req.admin.email || "CRM staff";
    const item = await InquiryLearning.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.admin.restaurantId },
      {
        question: req.body.question.trim(),
        answer: req.body.answer.trim(),
        category: String(req.body.category || "Other Questions").trim() || "Other Questions",
        sourceChatId: req.body.sourceChatId || null,
        isActive: req.body.isActive,
        updatedBy: adminName,
      },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ success: false, message: "Learning item not found." });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error("updateLearningItem error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteLearningItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid learning item id." });
    const item = await InquiryLearning.findOneAndDelete({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!item) return res.status(404).json({ success: false, message: "Learning item not found." });
    res.json({ success: true, message: "Learning item deleted." });
  } catch (error) {
    console.error("deleteLearningItem error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicLearningItems = async (req, res) => {
  try {
    if (!requireN8nApiKey(req, res)) return;
    const restaurantId = String(req.query.restaurantId || "restaurant-1").trim();
    if (!restaurantId || restaurantId.length > 100) {
      return res.status(400).json({ success: false, message: "A valid restaurantId is required." });
    }
    const items = await InquiryLearning.find({ restaurantId, isActive: true })
      .select("question answer category updatedAt")
      .sort({ updatedAt: -1 })
      .limit(MAX_PUBLIC_ITEMS)
      .lean();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: items });
  } catch (error) {
    console.error("getPublicLearningItems error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
