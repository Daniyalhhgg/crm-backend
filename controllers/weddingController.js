const mongoose = require("mongoose");
const axios = require("axios");
const Chat = require("../models/Chat");
const WeddingHall = require("../models/WeddingHall");
const WeddingHallDate = require("../models/WeddingHallDate");
const WeddingBooking = require("../models/WeddingBooking");
const Menu = require("../models/Menu");
const Reminder = require("../models/Reminder");
const { scheduleJob } = require("../services/reminderQueue");
const { publishDashboardNotification } = require("../services/dashboardNotificationService");

const RESTAURANT_ID = "restaurant-1";
const QUESTIONS = [
  { key: "weddingDate", prompt: "What is your preferred wedding date? Please use YYYY-MM-DD." },
  { key: "eventType", prompt: "What type of event is it: Mehndi, Baraat, Walima, Nikah, Engagement, or another function?" },
  { key: "guests", prompt: "Approximately how many guests will attend?" },
  { key: "eventTime", prompt: "What time should the event start and end?" },
  { key: "hallPreference", prompt: "Would you prefer an indoor hall, an outdoor setup, or either?" },
  { key: "seatingSetup", prompt: "What seating setup do you prefer?" },
  { key: "menuService", prompt: "Would you like buffet or served dining, and do you have any specific dishes in mind?" },
  { key: "dietaryNeeds", prompt: "Do you have any food preferences or dietary requirements?" },
  { key: "stageDecor", prompt: "What stage and decor style do you prefer, such as floral or themed decor?" },
  { key: "avNeeds", prompt: "Do you need sound, microphones, a projector, or an LED screen?" },
];
const STAGE_LABELS = {
  inquiry: "Inquiry", package_offer: "Package offer", interested: "Client interested",
  event_details: "Event details", hall_check: "Hall availability", proposal: "Proposal & quotation",
  advance_payment: "Advance payment", agreement: "Agreement / contract", cs_verification: "CS verification",
  confirmed: "Booking confirmed", finalization: "Decor & menu finalization",
  reminder: "Pre-wedding reminder", event_setup: "Event day setup", executed: "Event executed",
  feedback: "Thank-you & feedback", follow_up: "Follow up later", no_booking: "No booking",
};

const dayDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
const requireApiKey = (req, res) => {
  if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return false;
  }
  return true;
};
const restaurantFor = (req) => req.admin?.restaurantId || req.body?.restaurantId || req.query?.restaurantId || RESTAURANT_ID;
const populatedBooking = (query) => query.populate("hallId", "name capacity rentalPrice");
const notifyNewWeddingEnquiry = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `new_wedding_enquiry:${booking._id}`,
  type: "new_booking",
  title: "New wedding enquiry",
  message: `${booking.customerName || booking.customerPhone} · Wedding booking`,
  entityType: "wedding_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("New wedding enquiry dashboard notification failed:", error));
const notifyCustomerDeclined = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `customer_declined:wedding:${booking._id}:${booking.updatedAt?.getTime() || Date.now()}`,
  type: "customer_declined",
  title: "Customer did not proceed with wedding booking",
  message: `${booking.customerName || booking.customerPhone} · ${booking.stageHistory?.[booking.stageHistory.length - 1]?.note || "Customer declined the proposed options."}`,
  entityType: "wedding_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("Wedding decline dashboard notification failed:", error));
const notifyCustomerAgreed = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `customer_agreed:wedding:${booking._id}:${booking.updatedAt?.getTime() || Date.now()}`,
  type: "customer_agreed",
  title: "Customer agreed to proceed with wedding options",
  message: `${booking.customerName || booking.customerPhone} · ${booking.hallName || "Venue"} · ${booking.answers.weddingDate || "Date to confirm"}`,
  entityType: "wedding_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("Wedding agreement dashboard notification failed:", error));

function availabilityColor(statuses, halls) {
  if (halls.length && halls.every((hall) => statuses.get(String(hall._id))?.status === "available")) return "all_available";
  if (halls.length && halls.every((hall) => statuses.get(String(hall._id))?.status === "blocked")) return "all_blocked";
  const orchid = halls.find((hall) => hall.name === "Orchid Hall");
  const magnoliaOne = halls.find((hall) => hall.name === "Magnolia Hall 1");
  const magnoliaTwo = halls.find((hall) => hall.name === "Magnolia Hall 2");
  const onlyHallBooked = (selected) => selected
    && statuses.get(String(selected._id))?.status === "booked"
    && halls.filter((hall) => hall._id.toString() !== selected._id.toString())
      .every((hall) => statuses.get(String(hall._id))?.status === "available");
  if (onlyHallBooked(orchid)) return "orchid_booked";
  if (onlyHallBooked(magnoliaOne)) return "magnolia1_booked";
  if (onlyHallBooked(magnoliaTwo)) return "magnolia2_booked";
  return "mixed";
}

async function getDateRows(restaurantId, date) {
  const [halls, records] = await Promise.all([
    WeddingHall.find({ restaurantId, isActive: true, venueType: "wedding_hall" }).sort({ name: 1 }).lean(),
    WeddingHallDate.find({ restaurantId, date }).lean(),
  ]);
  const byHall = new Map(records.map((record) => [String(record.hallId), record]));
  return halls.map((hall) => ({
    hallId: hall._id,
    hallName: hall.name,
    capacity: hall.capacity,
    rentalPrice: hall.rentalPrice,
    isActive: hall.isActive,
    priceNote: hall.priceNote,
    status: byHall.get(String(hall._id))?.status || "available",
    note: byHall.get(String(hall._id))?.note || "",
    bookingId: byHall.get(String(hall._id))?.bookingId || null,
  }));
}

exports.getHalls = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const halls = await WeddingHall.find({ restaurantId: restaurantFor(req), venueType: "wedding_hall", ...(req.query.includeInactive === "true" ? {} : { isActive: true }) }).sort({ name: 1 }).lean();
    res.json({ success: true, data: halls });
  } catch (error) {
    console.error("getHalls error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateHall = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.hallId)) return res.status(400).json({ success: false, message: "Invalid hall id." });
    const { name, capacity, rentalPrice, priceNote, isActive } = req.body;
    if (typeof name !== "string" || !name.trim() || !Number.isInteger(Number(capacity)) || Number(capacity) < 1 || !Number.isFinite(Number(rentalPrice)) || Number(rentalPrice) < 0) {
      return res.status(400).json({ success: false, message: "Hall name, positive guest capacity and non-negative rental price are required." });
    }
    const hall = await WeddingHall.findOneAndUpdate(
      { _id: req.params.hallId, restaurantId: req.admin.restaurantId, venueType: "wedding_hall" },
      { name: name.trim(), capacity: Number(capacity), rentalPrice: Number(rentalPrice), priceNote: String(priceNote || ""), isActive: isActive !== false },
      { new: true, runValidators: true }
    );
    if (!hall) return res.status(404).json({ success: false, message: "Wedding hall not found." });
    res.json({ success: true, data: hall });
  } catch (error) {
    console.error("updateHall error:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.code === 11000 ? "Hall name already exists." : error.message });
  }
};

exports.getHallMonth = async (req, res) => {
  try {
    const match = String(req.query.month || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return res.status(400).json({ success: false, message: "month must use YYYY-MM." });
    const restaurantId = req.admin.restaurantId;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const [halls, records] = await Promise.all([
      WeddingHall.find({ restaurantId, venueType: "wedding_hall" }).sort({ name: 1 }).lean(),
      WeddingHallDate.find({ restaurantId, date: { $gte: start, $lt: end } }).lean(),
    ]);
    const recordMap = new Map(records.map((record) => [`${String(record.hallId)}:${dateKey(record.date)}`, record]));
    const days = [];
    for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      const key = dateKey(date);
      const hallsForDate = halls.map((hall) => {
        const record = recordMap.get(`${String(hall._id)}:${key}`);
        return { hallId: hall._id, hallName: hall.name, capacity: hall.capacity, rentalPrice: hall.rentalPrice, isActive: hall.isActive, status: record?.status || "available", note: record?.note || "", bookingId: record?.bookingId || null };
      });
      const statuses = new Map(hallsForDate.map((hall) => [String(hall.hallId), hall]));
      days.push({ date: key, color: availabilityColor(statuses, halls), halls: hallsForDate });
    }
    res.json({ success: true, data: { month: req.query.month, halls, days } });
  } catch (error) {
    console.error("getHallMonth error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkHallAvailability = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const params = req.method === "GET" ? req.query : req.body;
    const date = dayDate(String(params.date || ""));
    if (!date) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    const restaurantId = restaurantFor(req);
    const halls = await getDateRows(restaurantId, date);
    const requestedHall = params.hallId || params.hallName;
    const selected = requestedHall ? halls.find((hall) => String(hall.hallId) === requestedHall || hall.hallName.toLowerCase() === String(requestedHall).toLowerCase()) : null;
    if (requestedHall && !selected) return res.status(404).json({ success: false, message: "Wedding hall not found." });
    const data = selected || halls;
    res.json({ success: true, available: selected ? selected.status === "available" : halls.some((hall) => hall.status === "available"), data });
  } catch (error) {
    console.error("checkHallAvailability error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.suggestHallDates = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const fromDate = dayDate(String(req.query.fromDate || ""));
    const hallId = req.query.hallId || "";
    const guests = Math.max(0, Number(req.query.guests) || 0);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 5));
    if (!fromDate) return res.status(400).json({ success: false, message: "fromDate must be a valid YYYY-MM-DD date." });
    if (hallId && !mongoose.isValidObjectId(hallId)) return res.status(400).json({ success: false, message: "Invalid hallId." });
    const restaurantId = restaurantFor(req);
    const suggestions = await findSuggestions(restaurantId, fromDate, hallId, limit, guests);
    res.json({ success: true, data: suggestions });
  } catch (error) {
    console.error("suggestHallDates error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function findSuggestions(restaurantId, fromDate, hallId = "", limit = 5, guests = 0) {
  const halls = await WeddingHall.find({ restaurantId, isActive: true, venueType: "wedding_hall", ...(hallId ? { _id: hallId } : {}) }).sort({ name: 1 }).lean();
  const end = new Date(fromDate);
  end.setUTCDate(end.getUTCDate() + 180);
  const booked = await WeddingHallDate.find({
    restaurantId,
    hallId: { $in: halls.map((hall) => hall._id) },
    date: { $gte: fromDate, $lt: end },
    status: { $in: ["booked", "blocked"] },
  }).select("hallId date").lean();
  const unavailable = new Set(booked.map((row) => `${String(row.hallId)}:${dateKey(row.date)}`));
  const suggestions = [];
  for (let offset = 0; offset < 180 && suggestions.length < limit; offset++) {
    const date = new Date(fromDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const availableHalls = halls.filter((hall) => hall.capacity >= guests && !unavailable.has(`${String(hall._id)}:${dateKey(date)}`));
    if (availableHalls.length) suggestions.push({ date: dateKey(date), halls: availableHalls.map((hall) => ({ hallId: hall._id, hallName: hall.name, capacity: hall.capacity, rentalPrice: hall.rentalPrice })) });
  }
  return suggestions;
}

exports.updateHallDate = async (req, res) => {
  try {
    const date = dayDate(String(req.body.date || ""));
    const { hallId, status } = req.body;
    if (!date) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    if (!mongoose.isValidObjectId(hallId)) return res.status(400).json({ success: false, message: "A valid hallId is required." });
    if (!["available", "booked", "blocked"].includes(status)) return res.status(400).json({ success: false, message: "status must be available, booked or blocked." });
    const restaurantId = req.admin.restaurantId;
    const hall = await WeddingHall.findOne({ _id: hallId, restaurantId, isActive: true });
    if (!hall) return res.status(404).json({ success: false, message: "Active wedding hall not found." });
    const current = await WeddingHallDate.findOne({ restaurantId, hallId, date });
    if (current?.bookingId && current.status === "booked" && status !== "booked") return res.status(409).json({ success: false, message: "A confirmed booking owns this date. Cancel that booking before changing availability." });
    const record = await WeddingHallDate.findOneAndUpdate(
      { restaurantId, hallId, date },
      { status, note: String(req.body.note || "").slice(0, 500), updatedBy: req.admin._id, ...(status === "available" ? { bookingId: null } : {}) },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, data: record });
  } catch (error) {
    console.error("updateHallDate error:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.message });
  }
};

exports.startEnquiry = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const customerPhone = String(req.body.customerPhone || "").trim();
    if (!customerPhone) return res.status(400).json({ success: false, message: "customerPhone is required." });
    const restaurantId = restaurantFor(req);
    let booking = await WeddingBooking.findOne({ restaurantId, customerPhone, bookingType: "wedding", stage: { $nin: ["confirmed", "executed", "no_booking"] }, currentQuestionIndex: { $lt: 10 } }).sort({ createdAt: -1 });
    if (!booking) {
      booking = await WeddingBooking.create({
        restaurantId,
        bookingType: "wedding",
        customerPhone,
        customerName: String(req.body.customerName || "").slice(0, 160),
        source: "whatsapp",
        stage: "inquiry",
        stageHistory: [{ stage: "inquiry", actorName: "WhatsApp AI", note: "Wedding inquiry started." }],
      });
      void notifyNewWeddingEnquiry(req, booking);
    }
    const question = QUESTIONS[booking.currentQuestionIndex];
    if (question && booking.aiReplies.length === 0) booking.aiReplies.push({ questionIndex: booking.currentQuestionIndex, text: question.prompt });
    if (booking.isModified()) await booking.save();
    res.json({ success: true, data: { bookingId: booking._id, questionIndex: booking.currentQuestionIndex, complete: !question, question: question?.prompt || "", questionKey: question?.key || null, answers: booking.answers } });
  } catch (error) {
    console.error("startEnquiry error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveEnquiryAnswer = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const { customerPhone, answer } = req.body;
    const questionIndex = Number(req.body.questionIndex);
    if (!String(customerPhone || "").trim() || typeof answer !== "string" || !answer.trim() || !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= QUESTIONS.length) {
      return res.status(400).json({ success: false, message: "customerPhone, a non-empty answer and questionIndex from 0 to 9 are required." });
    }
    const booking = await WeddingBooking.findOne({ restaurantId: restaurantFor(req), customerPhone: String(customerPhone).trim(), bookingType: "wedding", stage: { $nin: ["confirmed", "executed", "no_booking"] } }).sort({ createdAt: -1 });
    if (!booking) return res.status(404).json({ success: false, message: "Start a wedding enquiry before saving answers." });
    if (questionIndex !== booking.currentQuestionIndex) return res.status(409).json({ success: false, message: "The answer does not match the current wedding question.", expectedQuestionIndex: booking.currentQuestionIndex });
    const question = QUESTIONS[questionIndex];
    if (question.key === "guests") {
      const guests = Number(answer.replace(/[^\d]/g, ""));
      if (!Number.isInteger(guests) || guests < 1) return res.status(400).json({ success: false, message: "Guest count must be a positive whole number." });
      booking.answers.guests = guests;
    } else if (question.key === "weddingDate") {
      const value = answer.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
      if (!dayDate(value)) return res.status(400).json({ success: false, message: "Please save the wedding date in YYYY-MM-DD format." });
      booking.answers.weddingDate = value;
    } else if (question.key === "eventTime") {
      const times = answer.match(/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b/gi) || [];
      booking.answers.startTime = (times[0] || answer).slice(0, 120);
      booking.answers.endTime = (times[1] || "").slice(0, 120);
    } else booking.answers[question.key] = answer.slice(0, 1000);
    booking.currentQuestionIndex += 1;
    if (booking.currentQuestionIndex === QUESTIONS.length) {
      booking.stage = "event_details";
      booking.stageHistory.push({ stage: "event_details", actorName: "WhatsApp AI", note: "All ten wedding enquiry answers collected." });
    }
    await booking.save();
    const nextQuestion = QUESTIONS[booking.currentQuestionIndex];
    res.json({ success: true, data: { bookingId: booking._id, questionIndex: booking.currentQuestionIndex, complete: !nextQuestion, question: nextQuestion?.prompt || "", questionKey: nextQuestion?.key || null, answers: booking.answers } });
  } catch (error) {
    console.error("saveEnquiryAnswer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

function addAiReply(booking, questionIndex, text) {
  booking.aiReplies.push({ questionIndex, text });
}

exports.handleEnquiryMessage = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const customerPhone = String(req.body.customerPhone || "").trim();
    const message = String(req.body.message || "").trim();
    if (!customerPhone || !message) return res.status(400).json({ success: false, message: "customerPhone and message are required." });
    const restaurantId = restaurantFor(req);
    let booking = await WeddingBooking.findOne({
      restaurantId,
      customerPhone,
      bookingType: "wedding",
      stage: { $nin: ["confirmed", "executed", "feedback", "follow_up", "no_booking"] },
      $or: [{ currentQuestionIndex: { $lt: QUESTIONS.length } }, { awaitingHallChoice: true }],
    }).sort({ createdAt: -1 });

    if (!booking && req.body.isWeddingStart !== true) return res.json({ success: true, data: { active: false, replyText: "" } });
    if (!booking) {
      booking = await WeddingBooking.create({
        restaurantId,
        bookingType: "wedding",
        customerPhone,
        customerName: String(req.body.customerName || "").slice(0, 160),
        source: "whatsapp",
        stage: "inquiry",
        stageHistory: [{ stage: "inquiry", actorName: "WhatsApp AI", note: "Wedding enquiry started from WhatsApp." }],
      });
      void notifyNewWeddingEnquiry(req, booking);
      const firstQuestion = QUESTIONS[booking.currentQuestionIndex].prompt;
      addAiReply(booking, 0, firstQuestion);
      await booking.save();
      return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex: 0, replyText: firstQuestion } });
    }

    if (booking.awaitingHallChoice) {
      const decline = /\b(no|nope|decline|not interested|not available|no booking)\b/i.test(message);
      if (decline && booking.alternateDates.length) {
        booking.awaitingHallChoice = false;
        await changeStage(booking, "no_booking", null, "Customer declined the suggested wedding dates.");
        const replyText = "Thank you for letting us know. Our team is here if you would like to enquire about another date.";
        addAiReply(booking, QUESTIONS.length + 1, replyText);
        await booking.save();
        void notifyCustomerDeclined(req, booking);
        return res.json({ success: true, data: { active: false, bookingId: booking._id, complete: true, replyText } });
      }
      const requestedDate = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] || booking.answers.weddingDate;
      const isOriginalDate = requestedDate === booking.answers.weddingDate;
      const isSuggestedDate = booking.alternateDates.includes(requestedDate);
      if (!dayDate(requestedDate) || (!isOriginalDate && !isSuggestedDate)) {
        const options = [booking.answers.weddingDate, ...booking.alternateDates].filter(Boolean);
        const replyText = `Please choose one of these dates and include the preferred hall name: ${options.join(", ")}.`;
        addAiReply(booking, QUESTIONS.length + 1, replyText);
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: true, replyText } });
      }
      const candidates = (await getDateRows(restaurantId, dayDate(requestedDate)))
        .filter((hall) => hall.status === "available" && hall.capacity >= Number(booking.answers.guests || 0));
      const requestedHall = candidates.find((hall) => message.toLowerCase().includes(hall.hallName.toLowerCase()));
      const hall = requestedHall || (candidates.length === 1 ? candidates[0] : null);
      if (!hall) {
        if (!candidates.length) {
          const suggestions = await findSuggestions(restaurantId, dayDate(requestedDate), "", 3, Number(booking.answers.guests || 0));
          booking.alternateDates = suggestions.map((item) => item.date);
          booking.awaitingHallChoice = Boolean(suggestions.length);
          const replyText = suggestions.length ? `That date is no longer available. Please choose another date: ${suggestions.map((item) => `${item.date} (${item.halls.map((itemHall) => itemHall.hallName).join(", ")})`).join("; ")}.` : "Those dates are no longer available. Our customer-care team will contact you with other options.";
          addAiReply(booking, QUESTIONS.length + 1, replyText);
          await booking.save();
          return res.json({ success: true, data: { active: Boolean(suggestions.length), bookingId: booking._id, complete: true, replyText } });
        }
        const replyText = `Please choose a hall for ${requestedDate}: ${candidates.map((item) => `${item.hallName} (capacity ${item.capacity})`).join(", ")}.`;
        addAiReply(booking, QUESTIONS.length + 1, replyText);
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: true, replyText } });
      }
      booking.acceptedAlternateDate = isOriginalDate ? "" : requestedDate;
      booking.hallId = hall.hallId;
      booking.hallName = hall.hallName;
      booking.awaitingHallChoice = false;
      await changeStage(booking, "hall_check", null, `Customer selected ${hall.hallName} for ${requestedDate}; availability rechecked.`);
      const replyText = `Thank you. ${hall.hallName} on ${requestedDate} is available for ${booking.answers.guests} guests. I have recorded your preference; our customer-care team will prepare the quotation and confirm the booking with you.`;
      addAiReply(booking, QUESTIONS.length + 1, replyText);
      await booking.save();
      void notifyCustomerAgreed(req, booking);
      return res.json({ success: true, data: { active: false, bookingId: booking._id, complete: true, replyText } });
    }

    const questionIndex = booking.currentQuestionIndex;
    const question = QUESTIONS[questionIndex];
    if (question.key === "guests") {
      const guests = Number(message.replace(/[^\d]/g, ""));
      if (!Number.isInteger(guests) || guests < 1) {
        const validationReply = "Please tell me the number of guests as a positive whole number.";
        addAiReply(booking, questionIndex, validationReply);
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText: validationReply } });
      }
      booking.answers.guests = guests;
    } else if (question.key === "weddingDate") {
      const value = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
      if (!dayDate(value)) {
        const validationReply = "Please send the wedding date in YYYY-MM-DD format (for example, 2026-09-05).";
        addAiReply(booking, questionIndex, validationReply);
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText: validationReply } });
      }
      booking.answers.weddingDate = value;
    } else if (question.key === "eventTime") {
      const times = message.match(/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b/gi) || [];
      booking.answers.startTime = (times[0] || message).slice(0, 120);
      booking.answers.endTime = (times[1] || "").slice(0, 120);
    } else {
      booking.answers[question.key] = message.slice(0, 1000);
    }

    booking.currentQuestionIndex += 1;
    let replyText = "";
    let complete = booking.currentQuestionIndex >= QUESTIONS.length;
    if (complete) {
      const date = dayDate(booking.answers.weddingDate);
      const guests = booking.answers.guests || 0;
      const dateHalls = date ? await getDateRows(restaurantId, date) : [];
      const available = dateHalls.filter((hall) => hall.status === "available" && hall.capacity >= guests);
      const alternatives = available.length ? [] : date ? await findSuggestions(restaurantId, date, "", 3, guests) : [];
      booking.alternateDates = alternatives.map((item) => item.date);
      booking.awaitingHallChoice = Boolean(available.length || alternatives.length);
      await changeStage(booking, "event_details", null, "All ten wedding enquiry answers collected.");
      await changeStage(booking, "hall_check", null, available.length ? "Requested date checked against each hall and guest capacity." : "Requested date unavailable; capacity-matched alternate dates suggested.");
      const menu = await Menu.findOne({ restaurantId, category: "Wedding Package" }).lean();
      const packageOptions = (menu?.weddingPackages || []).filter((item) => item.isActive !== false)
        .map((item) => `${item.name} Rs ${item.pricePerPerson}/guest`)
        .join("; ");
      const availabilityText = available.length
        ? `Available halls for ${booking.answers.weddingDate}: ${available.map((hall) => `${hall.hallName} (capacity ${hall.capacity})`).join(", ")}.`
        : `No matching hall is available for ${booking.answers.weddingDate}${alternatives.length ? `. Alternate dates: ${alternatives.map((item) => `${item.date} (${item.halls.map((hall) => hall.hallName).join(", ")})`).join("; ")}` : ""}.`;
      const guestPerks = [
        guests >= Number(menu?.grandestOffer?.perks?.find((perk) => /hall rental|no hall rental/i.test(perk.text))?.minimumGuests || 75) ? "hall rental waived" : "",
        guests >= Number(menu?.grandestOffer?.perks?.find((perk) => /standard room/i.test(perk.text))?.minimumGuests || 100) ? "complimentary standard room for the couple (subject to availability)" : "",
      ].filter(Boolean);
      const offerText = `Grandest Wedding Offer starts at Rs ${menu?.grandestOffer?.startingPrice ?? 1499} + tax${guestPerks.length ? `; eligible perks: ${guestPerks.join(", ")}` : ""}.`;
      const nextStep = available.length
        ? "Reply with your preferred hall name."
        : alternatives.length
          ? "Reply with your preferred alternate date and hall name."
          : "Our customer-care team will contact you with other date options.";
      replyText = `Thank you — I have saved your wedding details. ${availabilityText}${packageOptions ? ` Wedding menus: ${packageOptions}.` : ""} ${offerText} ${nextStep}`;
      addAiReply(booking, questionIndex + 1, replyText);
    } else {
      replyText = QUESTIONS[booking.currentQuestionIndex].prompt;
      addAiReply(booking, booking.currentQuestionIndex, replyText);
    }
    await booking.save();
    res.json({ success: true, data: { active: true, bookingId: booking._id, complete, questionIndex: booking.currentQuestionIndex, replyText, answers: booking.answers } });
  } catch (error) {
    console.error("handleWeddingEnquiryMessage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkEnquiryHalls = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const params = req.method === "GET" ? req.query : req.body;
    const date = dayDate(String(params.date || ""));
    if (!date) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    const halls = await getDateRows(restaurantFor(req), date);
    const guests = Math.max(0, Number(params.guests) || 0);
    const candidates = halls.filter((hall) => hall.status === "available" && (!guests || hall.capacity >= guests));
    const alternatives = candidates.length ? [] : await findSuggestions(restaurantFor(req), date, "", 5, guests);
    res.json({ success: true, data: { date: dateKey(date), guests, halls, availableHalls: candidates, alternatives } });
  } catch (error) {
    console.error("checkEnquiryHalls error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const { stage } = req.query;
    const query = { restaurantId: req.admin.restaurantId, bookingType: "wedding" };
    if (stage && WeddingBooking.stages.includes(stage)) query.stage = stage;
    const data = await populatedBooking(WeddingBooking.find(query).sort({ updatedAt: -1 })).lean();
    res.json({ success: true, data });
  } catch (error) {
    console.error("getWeddingBookings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid wedding booking id." });
    const data = await populatedBooking(WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" }));
    if (!data) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    res.json({ success: true, data });
  } catch (error) {
    console.error("getWeddingBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const customerPhone = String(req.body.customerPhone || "").trim();
    if (!customerPhone) return res.status(400).json({ success: false, message: "Customer phone is required." });
    const booking = await WeddingBooking.create({
      restaurantId: req.admin.restaurantId,
      bookingType: "wedding",
      customerPhone,
      customerName: String(req.body.customerName || "").trim(),
      customerEmail: String(req.body.customerEmail || "").trim(),
      source: "crm",
      stage: "inquiry",
      stageHistory: [{ stage: "inquiry", changedBy: req.admin._id, actorName: req.admin.name || "CRM staff", note: "Wedding inquiry created in CRM." }],
      answers: req.body.answers || {},
    });
    void notifyNewWeddingEnquiry(req, booking);
    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    console.error("createWeddingBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid wedding booking id." });
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    const previousStage = booking.stage;
    const allowed = ["customerName", "customerPhone", "customerEmail", "answers", "hallId", "hallName", "packageName", "menuPackageId", "selectedMenuName", "alternateDates", "acceptedAlternateDate", "followUpAt", "paymentProofUrl", "agreementUrl", "finalization", "eventExecutionNotes", "feedback"];
    if (req.body.paymentProofUrl !== undefined && req.body.paymentProofUrl !== booking.paymentProofUrl) {
      booking.paymentVerified = false;
      booking.paymentVerifiedAt = null;
      booking.paymentVerifiedBy = null;
      booking.paymentStatus = req.body.paymentProofUrl ? "proof_received" : "unpaid";
    }
    for (const key of allowed) if (req.body[key] !== undefined) booking[key] = req.body[key];
    if (req.body.stage && req.body.stage !== booking.stage) {
      if (!WeddingBooking.stages.includes(req.body.stage)) return res.status(400).json({ success: false, message: "Invalid wedding stage." });
      if (req.body.stage === "confirmed") return res.status(409).json({ success: false, message: "Use the confirm endpoint to verify payment and reserve the hall." });
      if (booking.stage === "confirmed" && req.body.stage !== "no_booking") return res.status(409).json({ success: false, message: "A confirmed wedding can only leave the confirmed stage by being closed as no booking." });
      if (booking.stage === "confirmed") await releaseHall(booking);
      await changeStage(booking, req.body.stage, req.admin, String(req.body.stageNote || ""));
    }
    await booking.save();
    if (booking.stage === "no_booking" && previousStage !== "no_booking") void notifyCustomerDeclined(req, booking);
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("updateWeddingBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function changeStage(booking, stage, admin, note = "") {
  booking.stage = stage;
  booking.stageHistory.push({ stage, changedBy: admin?._id || null, actorName: admin?.name || admin?.email || "WhatsApp AI", note: note.slice(0, 500) });
}

exports.updateStage = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid wedding booking id." });
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    const previousStage = booking.stage;
    const { stage, note, interested, followUpAt } = req.body;
    if (!WeddingBooking.stages.includes(stage)) return res.status(400).json({ success: false, message: "Invalid wedding stage." });
    if (stage === "confirmed") return res.status(409).json({ success: false, message: "Use the confirm endpoint so payment and hall inventory are verified." });
    if (stage === "interested" && interested === false) {
      booking.interested = false;
      booking.followUpAt = followUpAt ? new Date(followUpAt) : null;
      await changeStage(booking, "follow_up", req.admin, note || "Customer asked to follow up later.");
    } else if (stage === "no_booking") {
      if (req.body.alternateAccepted === false) booking.acceptedAlternateDate = "";
      if (booking.stage === "confirmed") await releaseHall(booking);
      await changeStage(booking, stage, req.admin, note || "Customer declined the available alternate.");
    } else {
      if (stage === "interested") booking.interested = interested !== false;
      if (followUpAt !== undefined) booking.followUpAt = followUpAt ? new Date(followUpAt) : null;
      if (stage === "agreement") booking.agreementSentAt = new Date();
      await changeStage(booking, stage, req.admin, note || "");
    }
    await booking.save();
    if (booking.stage === "no_booking" && previousStage !== "no_booking") void notifyCustomerDeclined(req, booking);
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("updateWeddingStage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createQuotation = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    const guests = Number(req.body.guests ?? booking.answers.guests);
    if (!Number.isInteger(guests) || guests < 1) return res.status(400).json({ success: false, message: "A positive guest count is required for a quotation." });
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: "Wedding Package" }).lean();
    if (!menu) return res.status(409).json({ success: false, message: "Seed the wedding menu before creating a quotation." });
    const selectedMenu = (menu.weddingPackages || []).find((item) => String(item._id) === String(req.body.menuPackageId) || item.name === req.body.menuName);
    if (!selectedMenu) return res.status(400).json({ success: false, message: "Choose a configured wedding menu package." });
    const hall = req.body.hallId ? await WeddingHall.findOne({ _id: req.body.hallId, restaurantId: req.admin.restaurantId }) : null;
    if (req.body.hallId && !hall) return res.status(404).json({ success: false, message: "Wedding hall not found." });
    const offerActive = Boolean(req.body.useGrandestOffer && menu.grandestOffer?.isActive);
    const rulesApplied = [];
    let hallRental = Number(hall?.rentalPrice || 0);
    const roomPerk = menu.grandestOffer?.perks?.find((perk) => /standard room/i.test(perk.text));
    const hallWaiverPerk = menu.grandestOffer?.perks?.find((perk) => /hall rental|no hall rental/i.test(perk.text));
    const roomThreshold = Number(roomPerk?.minimumGuests || 100);
    const hallThreshold = Number(hallWaiverPerk?.minimumGuests || 75);
    if (offerActive && guests >= roomThreshold) rulesApplied.push(`Complimentary Standard Room for Couple (${roomThreshold}+ guests; subject to availability)`);
    if (offerActive) rulesApplied.push("Complimentary hotel photoshoot access");
    if (offerActive) rulesApplied.push("20% restaurant bill discount for couple (applies to restaurant bill, not this event quotation)");
    if (offerActive && guests >= hallThreshold) {
      hallRental = 0;
      rulesApplied.push(`Hall rental waived (${hallThreshold}+ guests)`);
    }
    if (offerActive) {
      rulesApplied.push("One complimentary cake");
      rulesApplied.push("Terms & Conditions apply");
    }
    const menuSubtotal = Math.round(Number(selectedMenu.pricePerPerson) * guests * 100) / 100;
    const addOns = (Array.isArray(req.body.addOns) ? req.body.addOns : []).map((item) => {
      const configured = (menu.extraPrices || []).find((extra) => extra.label === item.label);
      if (!configured) throw new Error(`Unknown wedding add-on: ${item.label}`);
      const quantity = Number(item.quantity ?? guests);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid quantity for ${item.label}.`);
      const total = Math.round(configured.price * quantity * 100) / 100;
      return { label: configured.label, quantity, unitPrice: configured.price, total };
    });
    const addOnTotal = addOns.reduce((sum, item) => sum + item.total, 0);
    const decorCost = Number(req.body.decorCost || 0);
    if (!Number.isFinite(decorCost) || decorCost < 0) return res.status(400).json({ success: false, message: "Decor cost must be a non-negative number." });
    const subtotal = menuSubtotal + hallRental + addOnTotal + decorCost;
    const discount = 0;
    const configuredTax = req.body.taxPercent ?? menu.weddingTaxPercent;
    if (configuredTax === null || configuredTax === undefined || configuredTax === "") {
      return res.status(409).json({ success: false, message: "Set the hotel's actual wedding tax rate in the Wedding Package menu or this quotation before calculating a total." });
    }
    const taxPercent = Number(configuredTax);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) return res.status(400).json({ success: false, message: "Tax percent must be between 0 and 100." });
    const taxAmount = Math.round((subtotal - discount) * taxPercent) / 100;
    const total = Math.round((subtotal - discount + taxAmount) * 100) / 100;
    const advanceRequired = Math.round(total * 0.2 * 100) / 100;
    booking.answers.guests = guests;
    booking.hallId = hall?._id || null;
    booking.hallName = hall?.name || "";
    booking.packageName = offerActive ? menu.grandestOffer.title : "Standard wedding pricing";
    booking.menuPackageId = selectedMenu._id;
    booking.selectedMenuName = selectedMenu.name;
    booking.quotation = {
      guests, menuPricePerPerson: selectedMenu.pricePerPerson, menuSubtotal, hallRental,
      decorCost, addOns, discount, taxPercent, taxAmount, total, advanceRequired, rulesApplied,
      notes: String(req.body.notes || ""), generatedAt: new Date(),
    };
    await changeStage(booking, "proposal", req.admin, "Wedding quotation calculated from configured menu, hall and add-ons.");
    await booking.save();
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("createWeddingQuotation error:", error);
    res.status(error.message.startsWith("Unknown wedding add-on") || error.message.startsWith("Invalid quantity") ? 400 : 500).json({ success: false, message: error.message });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    if (!booking.paymentProofUrl) return res.status(409).json({ success: false, message: "Add the customer's advance payment proof before verification." });
    booking.paymentVerified = true;
    booking.paymentStatus = "verified";
    booking.paymentVerifiedAt = new Date();
    booking.paymentVerifiedBy = req.admin._id;
    await changeStage(booking, "cs_verification", req.admin, "CS verified the advance payment proof.");
    await booking.save();
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("verifyWeddingPayment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function reserveHall(booking, admin) {
  const date = dayDate(booking.acceptedAlternateDate || booking.answers.weddingDate);
  if (!date || !booking.hallId) throw new Error("Select a hall and valid event date before confirmation.");
  const hall = await WeddingHall.findOne({ _id: booking.hallId, restaurantId: booking.restaurantId, isActive: true }).lean();
  if (!hall) throw new Error("Select an active wedding hall before confirmation.");
  if (Number(booking.quotation.guests || booking.answers.guests || 0) > hall.capacity) {
    throw new Error(`${hall.name} capacity is ${hall.capacity} guests. Update the guest count or select another hall.`);
  }
  const record = await WeddingHallDate.findOneAndUpdate(
    { restaurantId: booking.restaurantId, hallId: booking.hallId, date, status: "available" },
    { $set: { status: "booked", bookingId: booking._id, updatedBy: admin._id, note: "Reserved by confirmed wedding booking." } },
    { new: true }
  );
  if (record) return;
  const existing = await WeddingHallDate.findOne({ restaurantId: booking.restaurantId, hallId: booking.hallId, date });
  if (existing?.status === "booked" && String(existing.bookingId) === String(booking._id)) return;
  if (!existing) {
    try {
      await WeddingHallDate.create({ restaurantId: booking.restaurantId, hallId: booking.hallId, date, status: "booked", bookingId: booking._id, updatedBy: admin._id, note: "Reserved by confirmed wedding booking." });
      return;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  const afterRace = await WeddingHallDate.findOne({ restaurantId: booking.restaurantId, hallId: booking.hallId, date });
  if (!afterRace || afterRace.status !== "booked" || String(afterRace.bookingId) !== String(booking._id)) {
    throw new Error("The selected hall/date is no longer available. Check the wedding hall calendar and offer another date.");
  }
}

async function releaseHall(booking) {
  const date = dayDate(booking.acceptedAlternateDate || booking.answers.weddingDate);
  if (!date || !booking.hallId) return;
  await WeddingHallDate.updateOne(
    { restaurantId: booking.restaurantId, hallId: booking.hallId, date, bookingId: booking._id, status: "booked" },
    { $set: { status: "available", bookingId: null, note: "Released after the wedding booking was closed." } }
  );
}

function weddingConfirmationText(booking) {
  const date = booking.acceptedAlternateDate || booking.answers.weddingDate;
  return [
    `Dear ${booking.customerName || "Customer"},`,
    "",
    "Your wedding booking at Hotel d'GATES is confirmed.",
    `Event: ${booking.answers.eventType || "Wedding"}`,
    `Hall: ${booking.hallName}`,
    `Date: ${date}`,
    `Time: ${[booking.answers.startTime, booking.answers.endTime].filter(Boolean).join(" – ") || "As agreed"}`,
    `Guests: ${booking.quotation.guests || booking.answers.guests || "As agreed"}`,
    `Menu: ${booking.selectedMenuName || booking.packageName || "As agreed"}`,
    `Advance verified: Rs ${Number(booking.quotation.advanceRequired || 0).toLocaleString("en-PK")}`,
    "",
    "Thank you for choosing Hotel d'GATES. We look forward to celebrating with you.",
  ].join("\n");
}

async function scheduleWeddingReminder(booking) {
  if (booking.reminderScheduledAt) return "";
  const eventDate = dayDate(booking.acceptedAlternateDate || booking.answers.weddingDate);
  if (!eventDate) return "Pre-wedding reminder was not scheduled because the event date is invalid.";
  const reminderAt = new Date(eventDate);
  reminderAt.setUTCDate(reminderAt.getUTCDate() - 1);
  reminderAt.setUTCHours(5, 0, 0, 0);
  if (reminderAt <= new Date()) return "Pre-wedding reminder was not scheduled because its send time has passed.";
  let reminder;
  try {
    reminder = await Reminder.create({
      fromNumber: booking.customerPhone.replace(/\D/g, ""),
      restaurantId: booking.restaurantId,
      customerName: booking.customerName,
      reason: "booking_later",
      reminderDate: reminderAt.toISOString().slice(0, 10),
      reminderTime: "10:00 AM",
      reminderAt,
      customerMessage: `Your wedding at Hotel d'GATES is tomorrow. Our team is preparing the decor, catering and AV setup. Please contact us if you need any final changes.`,
      source: `wedding_booking:${booking._id}`,
    });
    const job = await scheduleJob(reminder._id, reminderAt);
    reminder.jobId = String(job.id);
    await reminder.save();
    booking.reminderScheduledAt = reminderAt;
    booking.reminderWarning = "";
    return "";
  } catch (error) {
    if (reminder) await Reminder.deleteOne({ _id: reminder._id });
    console.error("Could not schedule wedding reminder:", error.message);
    return `Pre-wedding reminder could not be scheduled: ${error.message}`;
  }
}

exports.confirmBooking = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    if (booking.stage === "confirmed" && booking.confirmationMessageStatus !== "failed") {
      return res.status(409).json({ success: false, message: "This wedding is already confirmed. Use Chat History for any follow-up message." });
    }
    if (!booking.paymentVerified) return res.status(409).json({ success: false, message: "CS must verify the advance payment before confirmation." });
    if (!booking.agreementUrl) return res.status(409).json({ success: false, message: "Save the signed agreement/contract before confirmation." });
    await reserveHall(booking, req.admin);
    booking.answers.weddingDate = booking.acceptedAlternateDate || booking.answers.weddingDate;
    await changeStage(booking, "confirmed", req.admin, "Payment and contract verified; hall/date reserved.");
    await booking.save();
    const message = weddingConfirmationText(booking);
    let confirmationWarning = "";
    try {
      if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) throw new Error("WhatsApp Cloud API credentials are not configured.");
      await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: booking.customerPhone.replace(/\D/g, ""),
        type: "text",
        text: { body: message },
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } });
      booking.confirmationMessageStatus = "sent";
      booking.confirmationMessageError = "";
    } catch (error) {
      const sendError = error.response?.data?.error?.message || error.message || "WhatsApp confirmation could not be sent.";
      confirmationWarning = `Wedding confirmed, but its WhatsApp message failed: ${sendError}. Open Chat History and resend it in Agent mode.`;
      booking.confirmationMessageStatus = "failed";
      booking.confirmationMessageError = sendError.slice(0, 500);
      console.error("Wedding confirmed, but WhatsApp confirmation failed:", sendError);
    }
    await Chat.create({
      restaurantId: booking.restaurantId,
      customerPhone: booking.customerPhone,
      customerName: booking.customerName || "WhatsApp Customer",
      botReply: message,
      sender: "admin",
      direction: "admin_to_customer",
      source: "wedding_booking_confirmation",
      status: confirmationWarning ? "failed" : "sent",
      isBookingRelated: true,
      metadata: { weddingBookingId: String(booking._id), error: confirmationWarning ? booking.confirmationMessageError : "" },
    });
    const reminderWarning = await scheduleWeddingReminder(booking);
    booking.reminderWarning = reminderWarning;
    await booking.save();
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)), ...(confirmationWarning || reminderWarning ? { warning: [confirmationWarning, reminderWarning].filter(Boolean).join(" ") } : {}) });
  } catch (error) {
    console.error("confirmWeddingBooking error:", error);
    res.status(409).json({ success: false, message: error.message });
  }
};

exports.reviewAiReply = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    const reply = booking.aiReplies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ success: false, message: "AI reply not found." });
    reply.reviewed = req.body.reviewed !== false;
    await booking.save();
    res.json({ success: true, data: reply });
  } catch (error) {
    console.error("reviewWeddingAiReply error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendFollowUpLater = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    await changeStage(booking, "follow_up", req.admin, String(req.body.note || "Follow up later."));
    booking.followUpAt = req.body.followUpAt ? new Date(req.body.followUpAt) : null;
    await booking.save();
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("sendWeddingFollowUp error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.confirmNoBooking = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    const previousStage = booking.stage;
    if (booking.stage === "confirmed") await releaseHall(booking);
    await changeStage(booking, "no_booking", req.admin, String(req.body.note || "Customer declined the alternate date."));
    await booking.save();
    if (previousStage !== "no_booking") void notifyCustomerDeclined(req, booking);
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("markWeddingNoBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.scheduleReminder = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "wedding" });
    if (!booking) return res.status(404).json({ success: false, message: "Wedding booking not found." });
    if (booking.reminderScheduledAt) return res.status(409).json({ success: false, message: "A pre-wedding reminder is already scheduled." });
    const warning = await scheduleWeddingReminder(booking);
    if (warning) return res.status(409).json({ success: false, message: warning });
    await changeStage(booking, "reminder", req.admin, "Automatic pre-wedding WhatsApp reminder scheduled for the day before the event.");
    await booking.save();
    res.json({ success: true, data: await populatedBooking(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("scheduleWeddingReminder error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuestions = (req, res) => res.json({ success: true, data: QUESTIONS.map((item, index) => ({ index, ...item })) });
exports.getStages = (req, res) => res.json({ success: true, data: WeddingBooking.stages.map((id) => ({ id, label: STAGE_LABELS[id] || id })) });
exports.getPaymentInstructions = (req, res) => {
  const data = {
    bankName: process.env.PAYMENT_BANK_NAME || "Meezan Bank",
    accountTitle: process.env.PAYMENT_ACCOUNT_TITLE || "",
    accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER || "",
    iban: process.env.PAYMENT_IBAN || "",
  };
  data.configured = Boolean(data.accountTitle && (data.accountNumber || data.iban) && !/configure|placeholder|set_/i.test(`${data.accountTitle} ${data.accountNumber} ${data.iban}`));
  res.json({ success: true, data });
};
