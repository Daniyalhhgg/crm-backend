const mongoose = require("mongoose");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const Booking = require("../models/Booking");
const WeddingBooking = require("../models/WeddingBooking");
const Chat = require("../models/Chat");
const Reminder = require("../models/Reminder");
const Setting = require("../models/Setting");
const Menu = require("../models/Menu");
const menuCategoryForPackage = require("../utils/menuCategory");
const { checkAvailability, timeToMinutes } = require("../services/availabilityService");
const { getRoomAvailability, dateObject: roomDateObject } = require("../services/roomAvailabilityService");
const { scheduleJob, cancelJob } = require("../services/reminderQueue");
const { parseReminderDateTime } = require("../utils/dateParser");
const { publishDashboardNotification } = require("../services/dashboardNotificationService");

const paymentInstructions = () => {
  const instructions = {
    bankName: process.env.PAYMENT_BANK_NAME || "Meezan Bank",
    accountTitle: process.env.PAYMENT_ACCOUNT_TITLE || "",
    accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER || "",
    iban: process.env.PAYMENT_IBAN || "",
  };
  instructions.configured = Boolean(
    instructions.accountTitle &&
    (instructions.accountNumber || instructions.iban) &&
    !/configure|placeholder|set_/i.test(`${instructions.accountTitle} ${instructions.accountNumber} ${instructions.iban}`)
  );
  return instructions;
};

const notifyDashboard = (req, booking, event, title, message) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `${event}:${booking._id}:${booking.updatedAt?.getTime() || Date.now()}`,
  type: event,
  title,
  message,
  entityType: "booking",
  entityId: String(booking._id),
}).catch((error) => console.error(`Dashboard ${event} notification failed:`, error));

const emitBooking = (req, event, booking) => {
  const io = req.app.get("io");
  if (event === "new_booking") {
    const packageName = booking.package || booking.selectedMenuName || "Booking";
    void notifyDashboard(req, booking, "new_booking", "New booking received", `${booking.customerName || "Customer"} · ${packageName}`);
  }
  if (!io) return;
  if (event === "new_booking") {
    io.to("chat-admins").emit(event, {
      type: "NEW_BOOKING",
      data: booking,
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      booking,
    });
    return;
  }
  io.to("chat-admins").emit(event, { bookingId: booking._id, restaurantId: booking.restaurantId, booking });
};
const timeString = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const formatPkDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: process.env.SLOT_TIMEZONE || "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};
const moneyPk = (value) => `Rs ${Number(value || 0).toLocaleString("en-PK")}`;
const digitsOnly = (value) => String(value || "").replace(/\D/g, "");
const detectLanguage = (text, fallback = "en") => {
  const source = String(text || "");
  if ([...source].some((character) => {
    const code = character.codePointAt(0);
    return code >= 1536 && code <= 1791;
  })) return "ur";
  if (/\b(hai|hain|kya|kar|karo|chahiye|mujhe|aap|apko|aapki|aapka|mein|main|nahi|bhi|ka|ki|ke|ko|se|mera|meri|bata|bhej|karein|raha|rahi|theek|han|haan|ji|shukriya)\b/i.test(source)) return "roman";
  return fallback || "en";
};
const bookingDetailLines = (booking) => [
  `Package: ${booking.package || "Not recorded"}`,
  booking.bookingCategory ? `Category: ${booking.bookingCategory}` : "",
  ...(booking.selectedItems || []).map((item) => `Item: ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ""}`),
  ...(booking.bookingDetails || []).map((detail) => `${detail.label}: ${detail.value}`),
  booking.roomType ? `Room type: ${booking.roomType}` : "",
  booking.roomType ? `Rooms: ${booking.numberOfRooms || 1}` : "",
  booking.roomType ? `Check-in: ${formatPkDate(booking.bookingDate)}` : `Date: ${formatPkDate(booking.bookingDate)}`,
  booking.checkOutDate ? `Check-out: ${formatPkDate(booking.checkOutDate)}` : "",
  booking.roomType ? "" : `Time: ${booking.bookingTime || "Not recorded"}`,
  `Guests: ${booking.numberOfPersons || "Not recorded"}`,
  booking.specialRequests ? `Special requests: ${booking.specialRequests}` : "",
].filter(Boolean);
const bookingConfirmationText = (booking) => {
  const language = booking.customerLanguage || "en";
  const intro = language === "ur"
    ? `محترم/محترمہ ${booking.customerName},\n\nآپ کی ادائیگی موصول ہو گئی ہے اور تصدیق ہو گئی ہے۔ آپ کی بکنگ کنفرم ہے۔`
    : language === "roman"
      ? `Dear ${booking.customerName},\n\nAapki payment receive ho gayi hai aur verify ho gayi hai. Aapki booking confirm hai.`
      : `Dear ${booking.customerName},\n\nYour payment has been received and verified. Your booking is confirmed.`;
  return [
    intro,
    "",
    ...bookingDetailLines(booking),
    `Total bill: ${moneyPk(booking.totalAmount)}`,
    `Advance received: ${moneyPk(booking.advanceAmount)}`,
    "",
    language === "ur" ? "Hotel d'GATES کا شکریہ۔" : language === "roman" ? "Hotel d'GATES ka shukriya." : "Thank you for choosing Hotel d'GATES.",
  ].join("\n");
};
const customerWaitText = (language) => {
  if (language === "ur") return "ٹھیک ہے، ہمارے ساتھ جڑے رہیں۔ ہماری ٹیم 1 سے 5 منٹ میں ادائیگی کی تصدیق کر کے آپ کو کنفرم کر دے گی۔";
  if (language === "roman") return "Theek hai, hamare sath jude rahiye. Hamari team 1 se 5 minutes mein payment verify karke aapko confirm kar degi.";
  return "Please stay with us. Our team will verify the payment in 1 to 5 minutes and confirm it to you.";
};
const customerCsNotifyFailureText = (language) => {
  if (language === "ur") return "آپ کی تفصیلات محفوظ ہیں، لیکن ہم اس وقت ٹیم کو خودکار اطلاع نہیں دے سکے۔ براہ کرم کسٹمر سروس سے رابطہ کریں؛ ادائیگی ابھی تصدیق شدہ نہیں ہے۔";
  if (language === "roman") return "Aapki details save hain, lekin team ko automatic notification nahi ja saki. Barah-e-karam customer service se rabta karein; payment abhi verify nahi hui.";
  return "Your details are saved, but we could not notify the team automatically. Please contact customer service; your payment is not verified yet.";
};
const proofConfirmQuestion = (language) => {
  if (language === "ur") return "کیا یہ ادائیگی کا ثبوت کنفرم ہے؟ براہ کرم ہاں یا نہیں لکھیں۔";
  if (language === "roman") return "Kya yeh payment proof confirm hai? Please Haan ya Nahi likhein.";
  return "Is this payment proof confirmed? Please reply Yes or No.";
};
async function sendWhatsAppText(to, body) {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WhatsApp Cloud API credentials are not configured.");
  }
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: digitsOnly(to),
      type: "text",
      text: { body },
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}
async function notifyCsTeam({ caption, mediaUrl, mediaType = "image", mediaFilename = "" }) {
  const csNumber = process.env.WHATSAPP_CS_TEAM_NUMBER;
  if (!csNumber) return "Configure WHATSAPP_CS_TEAM_NUMBER to notify CS on WhatsApp.";
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WhatsApp Cloud API credentials are not configured.");
  }
  const payload = mediaUrl
    ? {
      messaging_product: "whatsapp",
      to: digitsOnly(csNumber),
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
        ...(mediaType === "document" && mediaFilename ? { filename: mediaFilename } : {}),
        ...(["image", "video", "document"].includes(mediaType) ? { caption } : {}),
      },
    }
    : {
      messaging_product: "whatsapp",
      to: digitsOnly(csNumber),
      type: "text",
      text: { body: caption },
    };
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
  return "";
}
const csPaymentCaption = (booking) => [
  "*Payment received — please verify*",
  "",
  `Customer: ${booking.customerName || "Customer"}`,
  `WhatsApp: +${digitsOnly(booking.customerPhone)}`,
  `Category: ${booking.bookingCategory || booking.package || "Booking"}`,
  `Package: ${booking.package || "Not recorded"}`,
  ...bookingDetailLines(booking).filter((line) => !line.startsWith("Package:")),
  `Total bill: ${moneyPk(booking.totalAmount)}`,
  `Advance due/received: ${moneyPk(booking.advanceAmount)}`,
  `Booking ID: ${booking._id}`,
  "",
  "Customer details are already saved on the Bookings page in this category section.",
  "Open Bookings → Pending payment verification to view the screenshot and verify.",
].join("\n");
const eventPaymentCaption = (booking, type) => [
  `*${type === "wedding" ? "Wedding" : "Corporate"} payment proof received — please verify*`,
  "",
  `Customer: ${booking.customerName || booking.answers?.contactPerson || "Customer"}`,
  `WhatsApp: +${digitsOnly(booking.customerPhone)}`,
  `Company/event: ${booking.answers?.companyName || booking.answers?.eventType || type}`,
  `Date: ${booking.acceptedAlternateDate || booking.answers?.weddingDate || booking.answers?.eventDate || "Not recorded"}`,
  `Venue: ${booking.hallName || "Not selected"}`,
  `Guests: ${booking.quotation?.guests || booking.answers?.guests || "Not recorded"}`,
  `Menu: ${booking.selectedMenuName || "Not recorded"}`,
  `Total bill: ${moneyPk(booking.quotation?.total)}`,
  `Advance due/received: ${moneyPk(booking.quotation?.advanceRequired)}`,
  `Booking ID: ${booking._id}`,
  "",
  "Customer details are saved in the matching Wedding/Corporate bookings section. Open the booking record to review the proof and verify or reject it with a reason.",
].join("\n");
const csDeclineCaption = (booking, reason) => [
  "*Advance payment not agreed*",
  "",
  `Customer: ${booking.customerName || "Customer"}`,
  `WhatsApp: +${digitsOnly(booking.customerPhone)}`,
  `Category: ${booking.bookingCategory || booking.package || "Booking"}`,
  `Package: ${booking.package || "Not recorded"}`,
  ...bookingDetailLines(booking).filter((line) => !line.startsWith("Package:")),
  `Total: ${moneyPk(booking.totalAmount)}`,
  `Advance asked: ${moneyPk(booking.advanceAmount)}`,
  `Reason: ${reason || "Customer did not agree to pay the 20% advance."}`,
  `Booking ID: ${booking._id}`,
  "",
  "Details are already saved. Open Customer Details in CRM to handle this customer.",
].join("\n");
const requireN8nKey = (req, res) => {
  if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return false;
  }
  return true;
};
const matchPhone = (stored, phone) => digitsOnly(stored).slice(-10) === digitsOnly(phone).slice(-10) && digitsOnly(phone).length >= 7;

async function confirmAndNotify(req, booking) {
  if (!["pending", "pending_payment_verification", "confirmed"].includes(booking.status)) {
    return { error: "Only pending bookings, or confirmed bookings with a failed WhatsApp message, can be confirmed." };
  }
  if (!["advance_received", "paid"].includes(booking.paymentStatus)) {
    return { error: "Verify the customer's advance payment before confirming this booking." };
  }

  if (isRoomBooking(booking)) {
    const availability = await checkBookingCapacity(booking.toObject(), booking.restaurantId, booking._id);
    if (!availability?.available) return { error: availability?.reason || "The selected room dates are no longer available." };
  }

  booking.status = "confirmed";
  booking.confirmedAt = booking.confirmedAt || new Date();
  booking.confirmedBy = booking.confirmedBy || req.admin._id;
  const message = bookingConfirmationText(booking);
  let sendError = "";
  try {
    await sendWhatsAppText(booking.customerPhone, message);
    booking.confirmationMessageStatus = "sent";
    booking.confirmationMessageError = "";
  } catch (error) {
    sendError = error.response?.data?.error?.message || error.message || "WhatsApp confirmation could not be sent.";
    booking.confirmationMessageStatus = "failed";
    booking.confirmationMessageError = sendError.slice(0, 500);
    console.error("Booking confirmed, but WhatsApp confirmation failed:", sendError);
  }

  await booking.save();
  await Chat.create({
    restaurantId: booking.restaurantId,
    customerPhone: booking.customerPhone,
    customerName: booking.customerName,
    botReply: message,
    sender: "admin",
    direction: "admin_to_customer",
    source: "booking_confirmation",
    status: sendError ? "failed" : "sent",
    isBookingRelated: true,
    bookingId: booking._id,
    metadata: sendError ? { error: sendError } : {},
  });
  const reminderWarning = await scheduleBookingReminder(booking);
  if (booking) emitBooking(req, "booking_updated", booking);
  return {
    booking,
    warning: [
      sendError ? `Booking confirmed, but its WhatsApp message failed: ${sendError}. Open Chat History and resend it in Agent mode.` : "",
      reminderWarning,
    ].filter(Boolean).join(" "),
  };
}

const availabilityCategoryForPackage = (packageName, categoryName = "") => {
  const menuCategory = categoryName || menuCategoryForPackage(packageName);
  return menuCategory === "Wedding Package" ? "Wedding" : menuCategory;
};
const isRoomBooking = (booking) =>
  availabilityCategoryForPackage(booking.package, booking.bookingCategory) === "Rooms" ||
  Boolean(booking.roomTypeId || booking.checkOutDate);

async function checkBookingCapacity(data, restaurantId) {
  const category = availabilityCategoryForPackage(data.package, data.bookingCategory);
  if (isRoomBooking(data)) {
    if (!Number.isInteger(Number(data.numberOfPersons)) || Number(data.numberOfPersons) < 1) {
      const error = new Error("Room bookings require a positive whole-number guest count.");
      error.status = 400;
      throw error;
    }
    const checkInDate = data.bookingDate instanceof Date
      ? data.bookingDate.toISOString().slice(0, 10)
      : String(data.bookingDate || "").slice(0, 10);
    const checkOutDate = data.checkOutDate instanceof Date
      ? data.checkOutDate.toISOString().slice(0, 10)
      : String(data.checkOutDate || "").slice(0, 10);
    if (!roomDateObject(checkInDate) || !roomDateObject(checkOutDate)) {
      const error = new Error("Room bookings require valid check-in and check-out dates.");
      error.status = 400;
      throw error;
    }
    return getRoomAvailability({
      restaurantId,
      checkInDate,
      checkOutDate,
      roomTypeId: data.roomTypeId,
      rooms: data.numberOfRooms || 1,
      guests: data.numberOfPersons,
      excludeBookingId: data._id,
    });
  }
  if (category === "Corporate" && (!data.bookingDate || !data.bookingTime)) {
    const error = new Error("Corporate bookings require a valid event date and time.");
    error.status = 400;
    throw error;
  }
  if (!category || !data.bookingDate || !data.bookingTime) return null;
  const date = new Date(data.bookingDate);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("bookingDate is invalid");
    error.status = 400;
    throw error;
  }
  if (typeof data.bookingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.bookingDate) && date.toISOString().slice(0, 10) !== data.bookingDate) {
    const error = new Error("bookingDate is not a valid calendar date");
    error.status = 400;
    throw error;
  }
  const minutes = timeToMinutes(data.bookingTime);
  if (minutes === null) {
    const error = new Error("bookingTime must be a valid 24-hour or AM/PM time");
    error.status = 400;
    throw error;
  }
  if (category === "Corporate") return null;
  return checkAvailability({
    restaurantId,
    date: date.toISOString().slice(0, 10),
    time: timeString(minutes),
    persons: Number(data.numberOfPersons) || 1,
    category,
  });
}

async function scheduleBookingReminder(booking) {
  const start = new Date(booking.bookingDate);
  const mins = timeToMinutes(booking.bookingTime);
  if (Number.isNaN(start.getTime()) || mins === null) return "Reminder not scheduled: booking date/time is invalid.";
  const reminderDate = new Date(start);
  reminderDate.setUTCDate(reminderDate.getUTCDate() - 1);
  const dateString = reminderDate.toISOString().slice(0, 10);
  const time = timeString(mins);
  const reminderAt = parseReminderDateTime(dateString, time);
  if (reminderAt <= new Date()) return "Reminder not scheduled: booking is less than one day away.";
  const existing = await Reminder.findOne({ bookingId: booking._id, status: "pending" });
  if (existing) {
    await cancelJob(existing.jobId);
    existing.status = "cancelled";
    await existing.save();
  }
  const reminder = await Reminder.create({
    bookingId: booking._id,
    fromNumber: String(booking.customerPhone).replace(/\D/g, ""),
    restaurantId: booking.restaurantId,
    customerName: booking.customerName,
    reason: "booking_later",
    reminderDate: dateString,
    reminderTime: time,
    reminderAt,
    customerMessage: `Reminder: your ${booking.package} booking is tomorrow at ${booking.bookingTime}. We look forward to welcoming you to Hotel d'GATES.`,
    source: "booking_confirmation",
  });
  try {
    const job = await scheduleJob(reminder._id, reminderAt);
    reminder.jobId = String(job.id);
    await reminder.save();
    return "";
  } catch (error) {
    await Reminder.findByIdAndDelete(reminder._id);
    console.error("Could not schedule booking reminder:", error.message);
    return `Booking confirmed, but its reminder could not be scheduled: ${error.message}`;
  }
}

async function cancelBookingReminder(booking) {
  const reminders = await Reminder.find({ bookingId: booking._id, status: "pending" });
  for (const reminder of reminders) {
    await cancelJob(reminder.jobId);
    reminder.status = "cancelled";
    await reminder.save();
  }
}

async function loyaltyForBooking(booking) {
  const category = menuCategoryForPackage(booking.package);
  const [setting, menu, visits] = await Promise.all([
    Setting.findOne({ restaurantId: booking.restaurantId }).lean(),
    category ? Menu.findOne({ restaurantId: booking.restaurantId, category }).lean() : null,
    Booking.find({ restaurantId: booking.restaurantId, status: { $in: ["checked_in", "completed"] } }).select("customerPhone package").lean(),
  ]);
  const config = menu?.loyalty || setting?.loyalty || { enabled: true, visitsForReward: 5, rewardText: "Chef Special Dessert" };
  const phone = String(booking.customerPhone || "").replace(/\D/g, "");
  const visitCount = visits.filter((visit) =>
    String(visit.customerPhone || "").replace(/\D/g, "") === phone &&
    (!category || menuCategoryForPackage(visit.package) === category)
  ).length;
  const required = config.visitsForReward || 5;
  const cycle = visitCount % required;
  const rewardEarned = Boolean(config.enabled && visitCount && cycle === 0);
  const remaining = cycle === 0 ? required : required - cycle;
  const lastTwo = visitCount % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[visitCount % 10] || "th";
  const message = !config.enabled ? "" : rewardEarned
    ? `Congratulations! You have earned a FREE ${config.rewardText}. Your next reward cycle starts now.`
    : `Thank you for your ${visitCount}${suffix} visit to Hotel d'GATES. You are ${remaining} more ${remaining === 1 ? "visit" : "visits"} away to enjoy '${config.rewardText}' for FREE.`;
  return { visitCount, visitsForReward: required, visitsRemaining: remaining, rewardText: config.rewardText, rewardEarned, enabled: config.enabled, message };
}

// ======================
// Get all bookings
// ======================
exports.getAllBookings = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`\n📅 getAllBookings:`);
    console.log(`   Restaurant: ${restaurantId}`);

    const bookings = await Booking.find({
      restaurantId: restaurantId
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings`);

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error("❌ Get All Bookings Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Create booking (Admin)
// ======================
exports.createBooking = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`\n📝 createBooking:`);
    console.log(`   Restaurant: ${restaurantId}`);

    const availability = await checkBookingCapacity(req.body, restaurantId);
    if (availability && !availability.available) {
      return res.status(409).json({ success: false, message: availability.reason || `No ${availabilityCategoryForPackage(req.body.package, req.body.bookingCategory)} availability for this time.`, availability });
    }
    const bookingData = { ...req.body };
    if (isRoomBooking(bookingData) && availability) {
      const checkIn = roomDateObject(String(bookingData.bookingDate).slice(0, 10));
      const checkOut = roomDateObject(String(bookingData.checkOutDate).slice(0, 10));
      bookingData.roomType = availability.roomType.name;
      bookingData.totalAmount = Math.round(availability.roomType.baseRate * Number(bookingData.numberOfRooms || 1) * ((checkOut - checkIn) / 86400000) * 100) / 100;
      bookingData.advanceAmount = Math.round(bookingData.totalAmount * 0.2 * 100) / 100;
      bookingData.bookingTime = bookingData.bookingTime || "15:00";
    }
    const booking = await Booking.create({
      ...bookingData,
      restaurantId,
      handledBy: "cs_manual",
      bookingSource: bookingData.bookingSource || "in-person",
    });

    emitBooking(req, "new_booking", booking);
    const reminderWarning = booking.status === "confirmed" ? await scheduleBookingReminder(booking) : "";

    console.log(`✅ Booking created: ${booking._id}`);

    res.status(201).json({
      success: true,
      data: booking,
      ...(reminderWarning ? { warning: reminderWarning } : {}),
    });
  } catch (error) {
    console.error("❌ Create Booking Error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Get booking by ID
// ======================
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid booking id" });

    console.log(`\n📅 getBookingById: ${id}`);

    const booking = await Booking.findOne({ _id: id, restaurantId: req.admin.restaurantId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    console.log(`✅ Booking found: ${booking._id}`);

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("❌ Get Booking Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Create booking from WhatsApp (n8n)
// ======================
exports.createBookingFromWhatsApp = async (req, res) => {
  try {
    if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const { bookingData, fromNumber, restaurantId = "restaurant-1" } = req.body;

    if (!bookingData || !fromNumber) {
      return res.status(400).json({
        success: false,
        message: "bookingData and fromNumber are required"
      });
    }

    let parsed = bookingData;
    if (typeof bookingData === "string") {
      try {
        parsed = JSON.parse(bookingData);
      } catch (e) {
        return res.status(400).json({ success: false, message: "bookingData must be valid JSON" });
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return res.status(400).json({ success: false, message: "bookingData must be an object" });
    }
    const assignedRestaurantId = parsed.restaurantId || restaurantId;
    const roomBooking = isRoomBooking(parsed);
    const totalAmount = Number(parsed.totalAmount);
    if (!roomBooking && (!Number.isFinite(totalAmount) || totalAmount <= 0)) {
      return res.status(400).json({ success: false, message: "A valid menu-based totalAmount is required before creating a WhatsApp booking." });
    }
    const selectedItems = Array.isArray(parsed.selectedItems)
      ? parsed.selectedItems.map((item) => ({
          name: String(item?.name || "").trim(),
          quantity: Number.isInteger(Number(item?.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 1,
          unitPrice: item?.unitPrice != null && Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0 ? Number(item.unitPrice) : null,
          notes: String(item?.notes || "").trim(),
        })).filter((item) => item.name)
      : [];
    if (!selectedItems.length && String(parsed.package || "").trim()) {
      selectedItems.push({ name: String(parsed.package).trim(), quantity: 1, unitPrice: null, notes: "" });
    }
    const bookingDetails = Array.isArray(parsed.bookingDetails)
      ? parsed.bookingDetails.map((detail) => ({
          label: String(detail?.label || "").trim(),
          value: String(detail?.value || "").trim(),
        })).filter((detail) => detail.label && detail.value)
      : [];
    const payload = {
      customerId: fromNumber,
      customerName: parsed.customerName || "WhatsApp Customer",
      customerPhone: fromNumber,
      customerEmail: parsed.customerEmail || "",
      handledBy: "whatsapp-bot",
      customerLanguage: parsed.customerLanguage || detectLanguage(parsed.notes || parsed.specialRequests || ""),
      package: parsed.package || "",
      bookingCategory: String(
        parsed.bookingCategory === "Wedding" ? "Wedding Package"
          : /d['’]fusion|fusion.*restaurant|revolving.*restaurant.*a\s*la\s*carte|revolving.*a\s*la\s*carte/i.test(String(parsed.bookingCategory || "")) ? "D'Fusion Revolving Restaurant: A La Carte Menu"
            : /^a\s*la\s*carte/i.test(String(parsed.bookingCategory || "")) ? "À la carte / Restaurant Reservation"
              : parsed.bookingCategory || menuCategoryForPackage(parsed.package) || ""
      ).trim(),
      selectedItems,
      bookingDetails,
      numberOfPersons: parsed.numberOfPersons || 1,
      bookingDate: parsed.bookingDate,
      bookingTime: parsed.bookingTime || (roomBooking ? "15:00" : ""),
      roomTypeId: parsed.roomTypeId || undefined,
      roomType: parsed.roomType || "",
      checkOutDate: parsed.checkOutDate || undefined,
      numberOfRooms: roomBooking ? Number(parsed.numberOfRooms || 1) : undefined,
      specialRequests: parsed.specialRequests || "",
      restaurantId: assignedRestaurantId,
      status: "pending",
      bookingSource: "whatsapp-bot",
      totalAmount,
      advanceAmount: Math.round(totalAmount * 0.2 * 100) / 100,
      paymentMethod: parsed.paymentMethod || "",
      paymentScreenshotUrl: "",
      paymentStatus: "unpaid",
      offerApplied: parsed.offerApplied || "",
    };
    const requestedDate = typeof payload.bookingDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(payload.bookingDate)
      ? payload.bookingDate.slice(0, 10)
      : payload.bookingDate && !Number.isNaN(new Date(payload.bookingDate).getTime())
        ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Karachi",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(payload.bookingDate))
        : "";
    if (!requestedDate) return res.status(400).json({ success: false, message: "A valid booking date is required." });
    const serviceSetting = await Setting.findOne({ restaurantId: assignedRestaurantId }).select("serviceClosures").lean();
    let requestDates = [requestedDate];
    if (roomBooking) {
      const checkIn = roomDateObject(requestedDate);
      const checkOut = roomDateObject(String(payload.checkOutDate || "").slice(0, 10));
      if (!checkIn || !checkOut || checkOut <= checkIn) {
        return res.status(400).json({ success: false, message: "Room bookings require a valid check-out date after check-in." });
      }
      requestDates = [];
      for (const date = new Date(checkIn); date < checkOut; date.setUTCDate(date.getUTCDate() + 1)) {
        requestDates.push(date.toISOString().slice(0, 10));
      }
    }
    const closure = serviceSetting?.serviceClosures?.find((item) => requestDates.includes(item.date));
    if (closure) {
      return res.status(409).json({
        success: false,
        message: `Hotel service is closed on ${requestedDate}: ${closure.reason}`,
        closure: { date: closure.date, reason: closure.reason },
      });
    }
    const availability = await checkBookingCapacity(payload, assignedRestaurantId);
    if (availability && !availability.available) {
      return res.status(409).json({
        success: false,
        message: availability.reason || `The requested ${availabilityCategoryForPackage(payload.package, payload.bookingCategory)} time is not available.`,
        availability,
      });
    }
    if (roomBooking && availability?.roomType) {
      const checkIn = roomDateObject(String(payload.bookingDate).slice(0, 10));
      const checkOut = roomDateObject(String(payload.checkOutDate).slice(0, 10));
      const nights = (checkOut - checkIn) / 86400000;
      payload.roomType = availability.roomType.name;
      payload.totalAmount = Math.round(availability.roomType.baseRate * payload.numberOfRooms * nights * 100) / 100;
      if (payload.totalAmount <= 0) return res.status(400).json({ success: false, message: "Configure a positive room rate before taking a room booking." });
      payload.advanceAmount = Math.round(payload.totalAmount * 0.2 * 100) / 100;
    }
    const booking = await Booking.create({
      ...payload,
      notes: parsed.notes || "",
    });

    console.log("✅ Booking created:", booking._id);

    emitBooking(req, "new_booking", booking);

    res.status(201).json({
      success: true,
      message: "Booking created from WhatsApp AI",
      data: booking,
      paymentInstructions: paymentInstructions(),
    });

  } catch (error) {
    console.error("❌ Create Booking from WhatsApp Error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Update booking status only (quick confirm/cancel)
// ======================
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid booking id" });
    const { status, remarks = "" } = req.body;
    const statuses = ["pending", "pending_payment_verification", "confirmed", "checked_in", "completed", "cancelled", "no_show"];
    if (!statuses.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${statuses.join(", ")}` });

    console.log(`\n📅 updateBookingStatus:`);
    console.log(`   ID: ${id}`);
    console.log(`   Status: ${status}`);

    const booking = await Booking.findOne({ _id: id, restaurantId: req.admin.restaurantId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (status === "cancelled" && booking.paymentScreenshotUrl && !String(remarks).trim()) {
      return res.status(400).json({ success: false, message: "Add a reason when rejecting a submitted payment proof." });
    }
    if (status === "confirmed") {
      const result = await confirmAndNotify(req, booking);
      if (result.error) return res.status(409).json({ success: false, message: result.error, data: booking });
      return res.json({ success: true, data: result.booking, ...(result.warning ? { warning: result.warning } : {}) });
    }
    const previousStatus = booking.status;
    booking.status = status;
    if (String(remarks || "").trim()) booking.csRemarks = String(remarks).trim().slice(0, 1000);
    if (status === "cancelled" && ["verifying", "proof_received", "unpaid", "payment_declined"].includes(booking.paymentStatus)) {
      booking.paymentStatus = "rejected";
      booking.paymentDeclineReason = String(remarks || "Payment proof rejected by CS.").trim().slice(0, 500);
    }
    await booking.save();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    if (status === "cancelled") {
      await cancelBookingReminder(booking);
      if (previousStatus !== "cancelled") {
        void notifyDashboard(req, booking, "booking_cancelled", "Booking cancelled", `${booking.customerName || "Customer"} · ${booking.package || "Booking"}`);
      }
    }
    if (booking) emitBooking(req, "booking_updated", booking);

    console.log(`✅ Booking status updated: ${booking._id}`);

    res.json({
      success: true,
      data: booking,
    });
  } catch (error) {
    console.error("❌ Update Booking Status Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.confirmBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid booking id" });
    const booking = await Booking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.status === "confirmed" && booking.confirmationMessageStatus !== "failed") {
      return res.status(409).json({ success: false, message: "This booking is already confirmed and its WhatsApp message was sent." });
    }
    const result = await confirmAndNotify(req, booking);
    if (result.error) return res.status(409).json({ success: false, message: result.error });
    res.json({ success: true, data: result.booking, ...(result.warning ? { warning: result.warning } : {}) });
  } catch (error) {
    console.error("confirmBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ======================
// Update full booking details (CRM edit)
// ======================
exports.updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid booking id" });

    const allowedFields = [
      "customerName",
      "customerEmail",
      "customerPhone",
      "package",
      "numberOfPersons",
      "bookingDate",
      "bookingTime",
      "roomTypeId",
      "roomType",
      "checkOutDate",
      "numberOfRooms",
      "specialRequests",
      "notes", "csRemarks", "totalAmount", "advanceAmount", "paymentMethod", "offerApplied",
      "bookingCategory", "selectedItems", "bookingDetails", "handledBy", "paymentStatus",
    ];

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });
    console.log(`\n✏️ updateBooking:`);
    console.log(`   ID: ${id}`);
    console.log(`   Fields:`, updateData);

    const existingBooking = await Booking.findOne({ _id: id, restaurantId: req.admin.restaurantId });
    if (!existingBooking) return res.status(404).json({ success: false, message: "Booking not found" });
    const availabilityData = { ...existingBooking.toObject(), ...updateData };
    const availability = await checkBookingCapacity(availabilityData, req.admin.restaurantId, id);
    if (availability && !availability.available) {
      return res.status(409).json({ success: false, message: availability.reason || "The selected availability is no longer open.", availability });
    }
    if (isRoomBooking(availabilityData) && availability) {
      const checkIn = roomDateObject(availabilityData.bookingDate instanceof Date ? availabilityData.bookingDate.toISOString().slice(0, 10) : String(availabilityData.bookingDate).slice(0, 10));
      const checkOut = roomDateObject(availabilityData.checkOutDate instanceof Date ? availabilityData.checkOutDate.toISOString().slice(0, 10) : String(availabilityData.checkOutDate).slice(0, 10));
      const totalAmount = Math.round(availability.roomType.baseRate * Number(availabilityData.numberOfRooms || 1) * ((checkOut - checkIn) / 86400000) * 100) / 100;
      updateData.roomType = availability.roomType.name;
      updateData.totalAmount = totalAmount;
      updateData.advanceAmount = Math.round(totalAmount * 0.2 * 100) / 100;
    }
    const booking = await Booking.findOneAndUpdate(
      { _id: id, restaurantId: req.admin.restaurantId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    if (booking.status === "confirmed") await scheduleBookingReminder(booking);
    if (booking.status === "cancelled") await cancelBookingReminder(booking);
    emitBooking(req, "booking_updated", booking);

    console.log(`✅ Booking fully updated: ${booking._id}`);

    res.json({ success: true, data: booking });
  } catch (error) {
    console.error("❌ Update Booking Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.capturePaymentScreenshot = async (req, res) => {
  try {
    if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const { url, mediaId, customerPhone, caption = "", restaurantId = "restaurant-1" } = req.body;
    const mediaType = String(req.body.mediaType || "image").toLowerCase();
    if (!["image", "video", "audio", "document"].includes(mediaType)) {
      return res.status(400).json({ success: false, message: "Unsupported WhatsApp media type" });
    }
    if (!mediaId && (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url))) {
      return res.status(400).json({ success: false, message: "A valid media URL or WhatsApp mediaId is required" });
    }
    const phone = String(customerPhone || "").replace(/\D/g, "");
    if (phone.length < 7) return res.status(400).json({ success: false, message: "A valid customerPhone is required" });
    const paymentProofType = ["image", "document"].includes(mediaType);
    let booking;
    let weddingBooking;
    let corporateBooking;
    if (paymentProofType && req.params.id) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid booking id" });
      booking = await Booking.findOne({ _id: req.params.id, restaurantId });
    } else if (paymentProofType) {
      const [candidates, weddingCandidates, corporateCandidates] = await Promise.all([
        Booking.find({ restaurantId, status: { $in: ["pending", "pending_payment_verification"] } }).sort({ createdAt: -1 }).limit(100),
        WeddingBooking.find({ restaurantId, bookingType: "wedding", paymentVerified: false, stage: { $in: ["proposal", "advance_payment", "agreement", "cs_verification"] } }).sort({ createdAt: -1 }).limit(100),
        WeddingBooking.find({ restaurantId, bookingType: "corporate", paymentVerified: false, stage: { $in: ["proposal", "advance_payment", "agreement", "cs_verification"] } }).sort({ createdAt: -1 }).limit(100),
      ]);
      booking = candidates.find((candidate) => String(candidate.customerPhone || "").replace(/\D/g, "") === phone);
      weddingBooking = weddingCandidates.find((candidate) => String(candidate.customerPhone || "").replace(/\D/g, "") === phone);
      corporateBooking = corporateCandidates.find((candidate) => String(candidate.customerPhone || "").replace(/\D/g, "") === phone);
      const matches = [booking, weddingBooking, corporateBooking].filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
      booking = matches[0] instanceof Booking ? matches[0] : null;
      weddingBooking = matches[0] instanceof WeddingBooking && matches[0].bookingType === "wedding" ? matches[0] : null;
      corporateBooking = matches[0] instanceof WeddingBooking && matches[0].bookingType === "corporate" ? matches[0] : null;
    }
    if (paymentProofType && req.params.id && !booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking && !["pending", "pending_payment_verification"].includes(booking.status)) return res.status(409).json({ success: false, message: "Payment screenshot can only be attached to a pending booking" });
    if (weddingBooking?.paymentVerified) return res.status(409).json({ success: false, message: "This wedding advance has already been verified." });
    if (corporateBooking?.paymentVerified) return res.status(409).json({ success: false, message: "This corporate advance has already been verified." });
    const attachedBooking = booking || weddingBooking || corporateBooking;

    let screenshotUrl = url;
    let mediaFilename = "";
    if (mediaId) {
      const requiredConfig = [
        process.env.WHATSAPP_ACCESS_TOKEN,
        process.env.CLOUDINARY_CLOUD_NAME,
        process.env.CLOUDINARY_API_KEY,
        process.env.CLOUDINARY_API_SECRET,
      ];
      if (requiredConfig.some((value) => !value)) {
        return res.status(503).json({ success: false, message: "WhatsApp media and Cloudinary upload credentials must be configured to save incoming media." });
      }
      const media = await axios.get(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      });
      if (typeof media.data?.url !== "string" || !media.data.url.startsWith("https://")) {
        return res.status(502).json({ success: false, message: "WhatsApp did not provide a valid media URL." });
      }
      mediaFilename = String(media.data.filename || "");
      const image = await axios.get(media.data.url, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        responseType: "arraybuffer",
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
      });
      const contentType = String(image.headers["content-type"] || "").split(";")[0].toLowerCase();
      const expectedType = mediaType === "document"
        ? contentType === "application/pdf"
        : contentType.startsWith(`${mediaType}/`);
      if (!expectedType) {
        return res.status(415).json({ success: false, message: `WhatsApp media content does not match the declared ${mediaType} type.` });
      }
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const resourceType = mediaType === "image" ? "image" : mediaType === "video" ? "video" : "raw";
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          resource_type: resourceType,
          folder: attachedBooking ? "hotel-crm/payments" : "hotel-crm/customer-media",
          ...(mediaType === "document" && mediaFilename ? { use_filename: true, unique_filename: true, filename_override: mediaFilename } : {}),
        }, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
        stream.end(Buffer.from(image.data));
      });
      screenshotUrl = uploaded.secure_url;
    }

    if (booking) {
      booking.paymentScreenshotUrl = screenshotUrl;
      booking.paymentStatus = "proof_received";
      booking.status = "pending_payment_verification";
      booking.paymentProofConfirmedByCustomer = false;
      if (caption) booking.customerLanguage = detectLanguage(caption, booking.customerLanguage);
      await booking.save();
    } else if (weddingBooking) {
      weddingBooking.paymentProofUrl = screenshotUrl;
      weddingBooking.paymentProofConfirmedByCustomer = false;
      weddingBooking.paymentStatus = "proof_received";
      weddingBooking.paymentVerified = false;
      weddingBooking.awaitingAdvancePayment = false;
      if (weddingBooking.stage !== "cs_verification") {
        weddingBooking.stage = "cs_verification";
        weddingBooking.stageHistory.push({
          stage: "cs_verification",
          actorName: "WhatsApp AI",
          note: "Customer payment proof received; awaiting customer confirmation and CS verification.",
        });
      }
      await weddingBooking.save();
    } else if (corporateBooking) {
      corporateBooking.paymentProofUrl = screenshotUrl;
      corporateBooking.paymentProofConfirmedByCustomer = false;
      corporateBooking.paymentStatus = "proof_received";
      corporateBooking.paymentVerified = false;
      if (corporateBooking.stage !== "cs_verification") {
        corporateBooking.stage = "cs_verification";
        corporateBooking.stageHistory.push({
          stage: "cs_verification",
          actorName: "WhatsApp AI",
          note: "Customer payment proof received; awaiting customer confirmation and CS verification.",
        });
      }
      await corporateBooking.save();
    }
    await Chat.create({
      restaurantId,
      customerPhone: attachedBooking?.customerPhone || phone,
      customerName: attachedBooking?.customerName || "WhatsApp Customer",
      customerMessage: String(caption).slice(0, 1000),
      messageType: mediaType,
      mediaUrl: screenshotUrl,
      sender: "customer",
      direction: "customer_to_bot",
      source: attachedBooking ? "whatsapp_payment_proof" : "whatsapp_customer_media",
      status: "received",
      isBookingRelated: Boolean(attachedBooking),
      bookingId: booking?._id || null,
      metadata: weddingBooking ? { weddingBookingId: String(weddingBooking._id), paymentProofUrl: screenshotUrl }
        : corporateBooking ? { corporateBookingId: String(corporateBooking._id), bookingType: "corporate", paymentProofUrl: screenshotUrl } : {},
    });

    const io = req.app.get("io");
    if (io) {
      if (attachedBooking) io.to("chat-admins").emit("payment_screenshot_received", { restaurantId, booking: attachedBooking, bookingType: corporateBooking ? "corporate" : weddingBooking ? "wedding" : "standard" });
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone: attachedBooking?.customerPhone || phone,
        customerName: attachedBooking?.customerName || "WhatsApp Customer",
        customerMessage: String(caption).slice(0, 1000),
        mediaUrl: screenshotUrl,
        mediaType,
        sender: "customer",
        timestamp: new Date(),
      });
    }
    if (booking) emitBooking(req, "booking_updated", booking);
    if (weddingBooking) {
      const io = req.app.get("io");
      if (io) io.to("chat-admins").emit("wedding_booking_updated", { bookingId: weddingBooking._id, restaurantId, booking: weddingBooking });
    }
    if (corporateBooking) {
      const io = req.app.get("io");
      if (io) io.to("chat-admins").emit("corporate_booking_updated", { bookingId: corporateBooking._id, restaurantId, booking: corporateBooking });
    }
    const language = detectLanguage(caption, attachedBooking?.customerLanguage || "en");
    const customerReply = attachedBooking
      ? proofConfirmQuestion(language)
      : language === "ur"
        ? "آپ کی فائل موصول ہو گئی ہے اور ٹیم کے لیے محفوظ کر لی گئی ہے۔"
        : language === "roman"
          ? "Aapki file mil gayi hai aur team ke liye save kar di gayi hai."
          : "We received your file and saved it for our team to review.";
    res.json({
      success: true,
      attachedToBooking: Boolean(attachedBooking),
      needsCustomerConfirmation: Boolean(attachedBooking),
      customerReply,
      bookingType: corporateBooking ? "corporate" : weddingBooking ? "wedding" : booking ? "standard" : null,
      data: attachedBooking || null,
      screenshotUrl,
    });
  } catch (error) {
    console.error("capturePaymentScreenshot error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { advanceAmount, paymentMethod } = req.body;
    if (advanceAmount !== undefined && (!Number.isFinite(Number(advanceAmount)) || Number(advanceAmount) < 0)) {
      return res.status(400).json({ success: false, message: "advanceAmount must be a non-negative number" });
    }
    if (paymentMethod !== undefined && typeof paymentMethod !== "string") return res.status(400).json({ success: false, message: "paymentMethod must be a string" });
    const booking = await Booking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.handledBy === "whatsapp-bot" && !booking.paymentProofConfirmedByCustomer) {
      return res.status(409).json({ success: false, message: "Wait for the customer to confirm the submitted payment proof before verification." });
    }
    if (!["pending", "pending_payment_verification"].includes(booking.status) || !["verifying", "proof_received"].includes(booking.paymentStatus) || !booking.paymentScreenshotUrl) {
      return res.status(409).json({ success: false, message: "A pending booking with a submitted payment proof is required before payment can be verified." });
    }
    booking.paymentStatus = "advance_received";
    if (advanceAmount !== undefined) booking.advanceAmount = Number(advanceAmount);
    if (paymentMethod !== undefined) booking.paymentMethod = paymentMethod.trim();
    booking.paymentVerifiedBy = req.admin._id;
    booking.paymentVerifiedAt = new Date();
    await booking.save();
    const result = await confirmAndNotify(req, booking);
    if (result.error) {
      emitBooking(req, "booking_updated", booking);
      return res.json({ success: true, data: booking, warning: `Payment verified, but confirmation could not be sent: ${result.error}` });
    }
    res.json({
      success: true,
      data: result.booking,
      message: "Payment verified. Booking confirmed and WhatsApp confirmation sent to the customer.",
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkInBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (!["confirmed", "checked_in"].includes(booking.status)) return res.status(409).json({ success: false, message: "Only confirmed bookings can be checked in" });
    booking.status = "checked_in";
    booking.checkedInAt = booking.checkedInAt || new Date();
    await booking.save();
    const loyalty = await loyaltyForBooking(booking);
    emitBooking(req, "booking_updated", booking);
    res.json({ success: true, data: booking, loyalty });
  } catch (error) {
    console.error("checkInBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const findLatestForPhone = async (restaurantId, phone, extra = {}) => {
  const candidates = await Booking.find({ restaurantId, ...extra }).sort({ createdAt: -1 }).limit(150);
  return candidates.find((candidate) => matchPhone(candidate.customerPhone, phone)) || null;
};

exports.confirmPaymentProof = async (req, res) => {
  try {
    if (!requireN8nKey(req, res)) return;
    const restaurantId = String(req.body.restaurantId || "restaurant-1").trim();
    const phone = digitsOnly(req.body.customerPhone || req.body.fromNumber);
    const language = detectLanguage(req.body.message, req.body.customerLanguage || "en");
    if (phone.length < 7) return res.status(400).json({ success: false, message: "A valid customerPhone is required" });
    const [standard, events] = await Promise.all([
      Booking.find({ restaurantId, status: { $in: ["pending", "pending_payment_verification"] }, paymentStatus: { $in: ["proof_received", "verifying"] } }).sort({ createdAt: -1 }).limit(100),
      WeddingBooking.find({ restaurantId, bookingType: { $in: ["wedding", "corporate"] }, paymentVerified: false, paymentStatus: "proof_received", stage: "cs_verification" }).sort({ createdAt: -1 }).limit(100),
    ]);
    const matches = [
      ...standard.filter((item) => matchPhone(item.customerPhone, phone)).map((item) => ({ booking: item, type: "standard" })),
      ...events.filter((item) => matchPhone(item.customerPhone, phone)).map((item) => ({ booking: item, type: item.bookingType })),
    ].sort((a, b) => b.booking.createdAt - a.booking.createdAt);
    const match = matches[0];
    if (!match) return res.json({ success: true, data: { active: false, replyText: "" } });
    const booking = match.booking;
    const text = String(req.body.message || "").trim();
    const affirmative = /^(yes|yeah|yep|haan|han|ji|confirm|confirmed|bilkul|theek hai|sahi hai|ہاں|جی|تصدیق ہے|بالکل)[.!،۔\s]*$/i.test(text);
    const negative = /^(no|nope|nahi|nahin|nahi hai|galat|wrong|not mine|نہیں|غلط)[.!،۔\s]*$/i.test(text);
    if (!affirmative && !negative) return res.json({ success: true, data: { active: false, replyText: "" } });
    if (negative) {
      booking.paymentProofConfirmedByCustomer = false;
      booking.customerLanguage = language;
      await booking.save();
      const replyText = language === "ur"
        ? "ٹھیک ہے، براہِ کرم درست ادائیگی کی رسید یا اسکرین شاٹ بھیج دیں۔ موجودہ بکنگ ادائیگی کی تصدیق تک زیرِ التوا رہے گی۔"
        : language === "roman"
          ? "Theek hai, meherbani karke sahi payment receipt ya screenshot bhej dein. Booking payment verify hone tak pending rahegi."
          : "Understood. Please send the correct payment receipt or screenshot. The booking will remain pending until payment is verified.";
      return res.json({ success: true, data: { active: true, replyText, bookingType: match.type } });
    }
    if (match.type === "standard") {
      booking.status = "pending_payment_verification";
      booking.paymentStatus = "verifying";
    }
    booking.paymentProofConfirmedByCustomer = true;
    booking.customerLanguage = language;
    await booking.save();
    if (match.type === "standard") emitBooking(req, "booking_updated", booking);
    else if (match.type === "wedding") req.app.get("io")?.to("chat-admins").emit("wedding_booking_updated", { bookingId: booking._id, restaurantId, booking });
    else req.app.get("io")?.to("chat-admins").emit("corporate_booking_updated", { bookingId: booking._id, restaurantId, booking });
    let warning = "";
    try {
      warning = await notifyCsTeam({
        caption: match.type === "standard" ? csPaymentCaption(booking) : eventPaymentCaption(booking, match.type),
        mediaUrl: match.type === "standard" ? booking.paymentScreenshotUrl : booking.paymentProofUrl,
        mediaType: "image",
      });
    } catch (error) {
      warning = `Proof was saved, but the CS WhatsApp notification failed: ${error.response?.data?.error?.message || error.message}`;
      console.error(warning);
    }
    const customerReply = warning ? customerCsNotifyFailureText(language) : customerWaitText(language);
    res.json({ success: true, data: { active: true, booking, replyText: customerReply, bookingType: match.type }, ...(warning ? { warning } : {}) });
  } catch (error) {
    console.error("confirmPaymentProof error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.declineAdvancePayment = async (req, res) => {
  try {
    if (!requireN8nKey(req, res)) return;
    const restaurantId = String(req.body.restaurantId || "restaurant-1").trim();
    const phone = digitsOnly(req.body.customerPhone || req.body.fromNumber);
    const reason = String(req.body.reason || req.body.message || "Customer did not agree to pay the 20% advance.").trim().slice(0, 500);
    const language = detectLanguage(req.body.message, req.body.customerLanguage || "en");
    if (phone.length < 7) return res.status(400).json({ success: false, message: "A valid customerPhone is required" });
    const message = String(req.body.message || "").trim();
    const explicitPaymentDecline = /\b(?:can't|cannot|cant|won't|will not|unable to|not able to)\s+(?:pay|make payment|send (?:the )?payment|afford)\b|\b(?:payment|advance)\s+(?:is\s+)?(?:not|no)\b|\b(?:payment|advance)\s+nahi\b|payment nahi karna|advance nahi karna/i.test(message)
      || /ادائیگی نہیں|ایڈوانس نہیں|پیسے نہیں دے سکتا|پیسے نہیں دے سکتی/.test(message);
    const generalRefusal = /\b(no|nope|not now|later|not interested|don't want|do not want|too expensive|cash|problem|issue|help|human|agent|can't|cannot|unable)\b/i.test(message)
      || /\b(nahi|nahin|nhi|abhi nahi|baad mein|masla|mushkil|mehnga|madad|insan|insaan|banday se|baat karni)\b/i.test(message)
      || /نہیں|ابھی نہیں|بعد میں|مسئلہ|مہنگا|مدد|انسان/.test(message);
    const phoneTail = phone.slice(-7);
    const phonePattern = new RegExp(phoneTail.split("").join("[^0-9]*") + "$");
    const lastBotMessage = await Chat.findOne({
      restaurantId,
      customerPhone: { $regex: phonePattern },
      botReply: { $ne: "" },
    }).sort({ createdAt: -1 }).select("botReply createdAt").lean();
    const recentPaymentRequest = lastBotMessage
      && Date.now() - new Date(lastBotMessage.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000
      && /\b(20\s*%|advance|payment|pay|account|transfer|deposit)\b|ادائیگی|ایڈوانس|پیسے|رقم/i.test(lastBotMessage.botReply);
    const declined = explicitPaymentDecline || (generalRefusal && recentPaymentRequest);
    if (!declined) return res.json({ success: true, data: { active: false, replyText: "" } });
    const booking = await findLatestForPhone(restaurantId, phone, {
      status: "pending",
      paymentStatus: { $in: ["unpaid", "payment_declined"] },
    });
    if (!booking) return res.json({ success: true, data: { active: false, replyText: "" } });
    booking.paymentStatus = "payment_declined";
    booking.paymentDeclineReason = reason;
    booking.customerLanguage = language;
    await booking.save();
    emitBooking(req, "booking_updated", booking);
    let warning = "";
    try {
      warning = await notifyCsTeam({ caption: csDeclineCaption(booking, reason) });
    } catch (error) {
      warning = `Saved in CRM, but the CS WhatsApp notification failed: ${error.response?.data?.error?.message || error.message}`;
      console.error(warning);
    }
    const customerReply = warning
      ? customerCsNotifyFailureText(language)
      : language === "ur"
        ? "سمجھ گیا۔ آپ کی تفصیلات محفوظ ہیں۔ ہماری ٹیم جلد آپ سے رابطہ کرے گی۔"
        : language === "roman"
          ? "Samajh gaya. Aapki details save hain. Hamari team jald aapse rabta karegi."
          : "Understood. Your details are saved. Our team will contact you shortly.";
    res.json({ success: true, data: { active: true, booking, replyText: customerReply }, ...(warning ? { warning } : {}) });
  } catch (error) {
    console.error("declineAdvancePayment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomerBookingContext = async (req, res) => {
  try {
    if (!requireN8nKey(req, res)) return;
    const restaurantId = String(req.query.restaurantId || "restaurant-1").trim();
    const phone = digitsOnly(req.query.phone || req.query.customerPhone);
    if (phone.length < 7) return res.status(400).json({ success: false, message: "A valid phone is required" });
    const phoneTail = phone.slice(-7);
    const phonePattern = new RegExp(phoneTail.split("").join("[^0-9]*") + "$");
    const [standard, events] = await Promise.all([
      Booking.find({ restaurantId, customerPhone: { $regex: phonePattern } }).sort({ createdAt: -1 }).limit(100).lean(),
      WeddingBooking.find({ restaurantId, customerPhone: { $regex: phonePattern } }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    const bookings = standard.filter((item) => matchPhone(item.customerPhone, phone)).slice(0, 8).map((item) => ({
      type: "standard",
      id: String(item._id),
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      handledBy: item.handledBy || "whatsapp-bot",
      bookingSource: item.bookingSource,
      status: item.status,
      paymentStatus: item.paymentStatus,
      paymentVerified: ["advance_received", "paid"].includes(item.paymentStatus),
      category: item.bookingCategory || item.package,
      package: item.package,
      selectedItems: item.selectedItems || [],
      bookingDetails: item.bookingDetails || [],
      date: item.bookingDate,
      time: item.bookingTime,
      guests: item.numberOfPersons,
      totalAmount: item.totalAmount,
      advanceAmount: item.advanceAmount,
      paymentProofOnFile: Boolean(item.paymentScreenshotUrl),
      csRemarks: item.csRemarks || "",
      paymentDeclineReason: item.paymentDeclineReason || "",
      createdAt: item.createdAt,
    }));
    const eventBookings = events.filter((item) => matchPhone(item.customerPhone, phone)).slice(0, 8).map((item) => ({
      type: item.bookingType || "wedding",
      id: String(item._id),
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      stage: item.stage,
      paymentStatus: item.paymentStatus,
      paymentVerified: Boolean(item.paymentVerified),
      status: item.stage,
      category: item.bookingType === "corporate" ? "Corporate" : "Wedding Package",
      package: item.selectedMenuName || item.packageName || "",
      details: item.answers || {},
      hallName: item.hallName || "",
      date: item.acceptedAlternateDate || item.answers?.weddingDate || item.answers?.eventDate || "",
      guests: item.quotation?.guests || item.answers?.guests || null,
      totalAmount: item.quotation?.total || 0,
      advanceAmount: item.quotation?.advanceRequired || 0,
      paymentProofOnFile: Boolean(item.paymentProofUrl),
      agreementRequired: true,
      agreementSaved: Boolean(item.agreementUrl),
      createdAt: item.createdAt,
    }));
    const latest = [...bookings, ...eventBookings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    const hasPaymentDecline = bookings.some((item) => item.paymentStatus === "payment_declined" || item.paymentDeclineReason);
    res.json({
      success: true,
      data: {
        phone,
        bookings,
        eventBookings,
        hasPaymentDecline,
        instruction: latest
          ? `This customer already has CRM records. Never say they have not booked, not paid, or must provide booking details again if a matching record shows otherwise. Latest: ${latest.category} · status ${latest.status} · payment ${latest.paymentStatus} · handled by ${latest.handledBy || "CRM team"}.`
          : "No saved CRM booking for this phone yet.",
      },
    });
  } catch (error) {
    console.error("getCustomerBookingContext error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};