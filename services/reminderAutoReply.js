const axios = require("axios");

const REASON_CONTEXT = {
  payment_pending: "The customer said they will make or confirm payment later.",
  booking_later: "The customer said they will decide or make a booking later.",
  visit_later: "The customer said they may visit later.",
  general: "This is a customer follow-up reminder.",
};

async function generateMistralReply(reason, customerMessage = "", customerName = "") {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured; automatic reminder message cannot be generated.");

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-small",
      messages: [
        {
          role: "system",
          content: "Write a brief, polite WhatsApp follow-up for Hotel d'GATES using the customer's language (English, Roman Urdu, or Urdu). Refer only to the reminder context; do not claim a booking or payment exists. Ask one gentle question. No placeholders or emojis.",
        },
        {
          role: "user",
          content: `Reason: ${REASON_CONTEXT[reason] || REASON_CONTEXT.general}\nCustomer name: ${customerName || "not provided"}\nCustomer's earlier message: ${customerMessage || "not provided"}`,
        },
      ],
      max_tokens: 120,
      temperature: 0.4,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  const message = response.data?.choices?.[0]?.message?.content?.trim();
  if (!message) throw new Error("AI reminder service returned an empty message.");
  return message;
}

function whatsappCredentials(toPhone) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error("WhatsApp credentials are not configured.");
  const phone = String(toPhone || "").replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(phone)) throw new Error("Reminder recipient phone number is invalid.");
  return { token, phoneNumberId, phone };
}

async function sendWhatsAppMessage(toPhone, message) {
  const { token, phoneNumberId, phone } = whatsappCredentials(toPhone);
  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );
  return response.data;
}

async function sendWhatsAppTemplate(toPhone, message) {
  const { token, phoneNumberId, phone } = whatsappCredentials(toPhone);
  const templateName = process.env.WHATSAPP_REMINDER_TEMPLATE_NAME;
  if (!templateName) throw new Error("WHATSAPP_REMINDER_TEMPLATE_NAME must be set to an approved WhatsApp reminder template.");
  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_REMINDER_TEMPLATE_LANGUAGE || "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: String(message).slice(0, 1024) },
          ],
        }],
      },
    },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  return response.data;
}

async function fireReminderAutoReply(reminder) {
  const message = await generateMistralReply(reminder.reason, reminder.customerMessage, reminder.customerName);
  const stillInServiceWindow = reminder.customerWindowExpiresAt && new Date() < new Date(reminder.customerWindowExpiresAt);
  const delivery = stillInServiceWindow
    ? await sendWhatsAppMessage(reminder.fromNumber, message)
    : await sendWhatsAppTemplate(reminder.fromNumber, message);
  return { success: true, message, messageId: delivery?.messages?.[0]?.id || "" };
}

module.exports = { fireReminderAutoReply, generateMistralReply, sendWhatsAppMessage, sendWhatsAppTemplate };
