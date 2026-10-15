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
const bookingConfirmationText = (booking) => {
  const date = new Intl.DateTimeFormat("en-PK", {
    timeZone: process.env.SLOT_TIMEZONE || "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(booking.bookingDate));
  return [
    `Dear ${booking.customerName},`,
    "",
    "Your booking is confirmed.",
    `Package: ${booking.package}`,
    ...(booking.roomType ? [
      `Room type: ${booking.roomType}`,
      `Rooms: ${booking.numberOfRooms || 1}`,
      `Check-in: ${date}`,
      `Check-out: ${booking.checkOutDate ? new Intl.DateTimeFormat("en-PK", { timeZone: process.env.SLOT_TIMEZONE || "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" }).format(new Date(booking.checkOutDate)) : "Not provided"}`,
    ] : [`Date: ${date}`, `Time: ${booking.bookingTime}`]),
    `Guests: ${booking.numberOfPersons}`,
    `Advance received: Rs ${Number(booking.advanceAmount || 0).toLocaleString("en-PK")}`,
    "",
    "Thank you for choosing Hotel d'GATES.",
  ].join("\n");
};

async function confirmAndNotify(req, booking) {
  if (!["pending", "confirmed"].includes(booking.status)) {
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
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error("WhatsApp Cloud API credentials are not configured.");
    }
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: String(booking.customerPhone).replace(/\D/g, ""),
        type: "text",
        text: { body: message },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
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
      restaurantId: restaurantId
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
    console.log("📅 BOOKING REQUEST FROM n8n:", req.body);

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
    if (isRoomBooking) {
      const checkIn = roomDateObject(payload.bookingDate.slice(0, 10));
      const checkOut = roomDateObject(payload.checkOutDate.slice(0, 10));
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
    const { status } = req.body;
    const statuses = ["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"];
    if (!statuses.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${statuses.join(", ")}` });

    console.log(`\n📅 updateBookingStatus:`);
    console.log(`   ID: ${id}`);
    console.log(`   Status: ${status}`);

    const booking = await Booking.findOne({ _id: id, restaurantId: req.admin.restaurantId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (status === "confirmed") {
      const result = await confirmAndNotify(req, booking);
      if (result.error) return res.status(409).json({ success: false, message: result.error, data: booking });
      return res.json({ success: true, data: result.booking, ...(result.warning ? { warning: result.warning } : {}) });
    }
    const previousStatus = booking.status;
    booking.status = status;
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
      "notes", "totalAmount", "advanceAmount", "paymentMethod", "offerApplied",
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
        Booking.find({ restaurantId, status: "pending" }).sort({ createdAt: -1 }).limit(100),
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
    if (booking && booking.status !== "pending") return res.status(409).json({ success: false, message: "Payment screenshot can only be attached to a pending booking" });
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
      booking.paymentStatus = "verifying";
      await booking.save();
    } else if (weddingBooking) {
      weddingBooking.paymentProofUrl = screenshotUrl;
      weddingBooking.paymentStatus = "proof_received";
      weddingBooking.paymentVerified = false;
      await weddingBooking.save();
    } else if (corporateBooking) {
      corporateBooking.paymentProofUrl = screenshotUrl;
      corporateBooking.paymentStatus = "proof_received";
      corporateBooking.paymentVerified = false;
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
    let warning = "";
    if (process.env.WHATSAPP_CS_TEAM_NUMBER) {
      try {
        if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
          throw new Error("WhatsApp Cloud API credentials are not configured.");
        }
        await axios.post(
          `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: process.env.WHATSAPP_CS_TEAM_NUMBER.replace(/\D/g, ""),
            type: mediaType,
            [mediaType]: {
              link: screenshotUrl,
              ...(mediaType === "document" && mediaFilename ? { filename: mediaFilename } : {}),
              ...(["image", "video", "document"].includes(mediaType) ? { caption: attachedBooking
                ? `Payment proof received: ${attachedBooking.customerName} · ${corporateBooking ? "Corporate event" : weddingBooking ? attachedBooking.selectedMenuName || "Wedding booking" : attachedBooking.package} · booking ${attachedBooking._id}`
                : `Customer ${mediaType} received from +${phone}.` } : {}),
            },
          },
          { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
        );
      } catch (error) {
        warning = `Proof was saved in CRM, but the CS WhatsApp notification failed: ${error.response?.data?.error?.message || error.message}`;
        console.error(warning);
      }
    } else {
      warning = "Image was saved in CRM. Configure WHATSAPP_CS_TEAM_NUMBER to forward it to the CS team.";
      console.warn(warning);
    }
    res.json({ success: true, attachedToBooking: Boolean(attachedBooking), bookingType: corporateBooking ? "corporate" : weddingBooking ? "wedding" : booking ? "standard" : null, data: attachedBooking || null, screenshotUrl, ...(warning ? { warning } : {}) });
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
    if (booking.status !== "pending" || booking.paymentStatus !== "verifying" || !booking.paymentScreenshotUrl) {
      return res.status(409).json({ success: false, message: "A pending booking with a submitted payment proof is required before payment can be verified." });
    }
    booking.paymentStatus = "advance_received";
    if (advanceAmount !== undefined) booking.advanceAmount = Number(advanceAmount);
    if (paymentMethod !== undefined) booking.paymentMethod = paymentMethod.trim();
    booking.paymentVerifiedBy = req.admin._id;
    booking.paymentVerifiedAt = new Date();
    await booking.save();
    emitBooking(req, "booking_updated", booking);
    res.json({ success: true, data: booking, message: "Advance payment verified. Confirm the booking separately when ready." });
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