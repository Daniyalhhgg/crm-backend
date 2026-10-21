const Setting = require("../models/Setting");
const defaultPrompt = require("../config/defaultAgentPrompt.json").prompt;
const REMINDER_PROMPT_START = "\n\nAUTOMATIC FOLLOW-UP REMINDERS";
const reminderStart = defaultPrompt.lastIndexOf(REMINDER_PROMPT_START);
const reminderPromptRules = reminderStart >= 0 ? defaultPrompt.slice(reminderStart) : "";
const followUpDelayLabel = (minutes) => {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

const activePrompt = (content) => {
  const text = String(content || "");
  const markerIndex = text.lastIndexOf(REMINDER_PROMPT_START);
  const base = (markerIndex >= 0 ? text.slice(0, markerIndex) : text).trimEnd();
  return `${base}${reminderPromptRules}`;
};

const promptWithFollowUpTiming = (content, delayMinutes) => {
  const prompt = activePrompt(content);
  const timing = followUpDelayLabel(delayMinutes);
  return prompt
    .replace("exactly 24 hours after the timestamp", `after the live CRM-configured delay (${timing}) from the message timestamp`)
    .replace("The schedule is fixed at 24 elapsed hours;", `The live CRM Follow-up Reminders setting controls the delay (${timing});`)
    .replace("saying we will follow up in 24 hours", `stating that we will follow up in ${timing}, in the customer's language`);
};

const MAX_HISTORY = 20;
const MAX_PROMPT_LENGTH = 50000;

const adminName = (admin) => admin?.name || admin?.email || "Admin";

const requireN8nApiKey = (req, res) => {
  const expected = process.env.N8N_API_KEY;
  if (!expected) {
    res.status(503).json({ success: false, message: "AI prompt API is not configured: N8N_API_KEY is required." });
    return false;
  }
  if (req.get("x-api-key") !== expected) {
    res.status(401).json({ success: false, message: "Invalid API key." });
    return false;
  }
  return true;
};

const getOrCreatePromptSettings = async (restaurantId) => {
  const setting = await Setting.findOneAndUpdate(
    { restaurantId },
    {
      $setOnInsert: {
        restaurantId,
        agentPrompt: {
          content: defaultPrompt,
          revision: 1,
          updatedAt: new Date(),
          updatedBy: "System default",
          history: [],
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!setting.agentPrompt?.content?.trim()) {
    setting.agentPrompt = {
      content: defaultPrompt,
      revision: 1,
      updatedAt: new Date(),
      updatedBy: "System default",
      history: setting.agentPrompt?.history || [],
    };
    await setting.save();
  }
  return setting;
};

exports.getAgentPrompt = async (req, res) => {
  try {
    const setting = await getOrCreatePromptSettings(req.admin.restaurantId);
    const promptData = setting.agentPrompt.toObject ? setting.agentPrompt.toObject() : setting.agentPrompt;
    const delayMinutes = Number(setting.followUpReminderDelayMinutes) || 1440;
    res.json({ success: true, data: { ...promptData, content: promptWithFollowUpTiming(setting.agentPrompt.content, delayMinutes) } });
  } catch (error) {
    console.error("getAgentPrompt error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveAgentPrompt = async (req, res, content) => {
  try {
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, message: "Prompt content is required and cannot be empty." });
    }
    if (content.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ success: false, message: `Prompt content must be ${MAX_PROMPT_LENGTH} characters or fewer.` });
    }

    const restaurantId = req.admin.restaurantId;
    const setting = await getOrCreatePromptSettings(restaurantId);
    const now = new Date();
    const history = [...(setting.agentPrompt.history || []), {
      revision: setting.agentPrompt.revision,
      content: setting.agentPrompt.content,
      updatedAt: setting.agentPrompt.updatedAt || setting.createdAt || now,
      updatedBy: setting.agentPrompt.updatedBy || "System default",
    }].slice(-MAX_HISTORY);
    setting.agentPrompt = {
      content: content.trim(),
      revision: setting.agentPrompt.revision + 1,
      updatedAt: now,
      updatedBy: adminName(req.admin),
      history,
    };
    await setting.save();
    res.json({ success: true, data: setting.agentPrompt });
  } catch (error) {
    console.error("updateAgentPrompt error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAgentPrompt = async (req, res) => saveAgentPrompt(req, res, req.body?.content);

exports.resetAgentPrompt = async (req, res) => {
  return saveAgentPrompt(req, res, defaultPrompt);
};

exports.getPublicAgentPrompt = async (req, res) => {
  try {
    if (!requireN8nApiKey(req, res)) return;
    const restaurantId = String(req.query.restaurantId || "restaurant-1").trim();
    if (!restaurantId || restaurantId.length > 100) {
      return res.status(400).json({ success: false, message: "A valid restaurantId is required." });
    }
    const setting = await getOrCreatePromptSettings(restaurantId);
    const delayMinutes = Number(setting.followUpReminderDelayMinutes) || 1440;
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: { prompt: promptWithFollowUpTiming(setting.agentPrompt.content, delayMinutes), revision: setting.agentPrompt.revision } });
  } catch (error) {
    console.error("getPublicAgentPrompt error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
