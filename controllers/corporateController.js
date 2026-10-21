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
const SETUPS = ["Theatre", "Classroom", "U-Shape", "Boardroom", "Banquet"];
const CORPORATE_INTRO = "Dear Guest, Thank you for considering us for your corporate event. To assist you with your booking, kindly share the following details:";
const CORPORATE_FINISH = "Once we receive these details, our team will share the available hall options, menu, package price, and booking details with you. We look forward to hosting your event.";
const QUESTIONS = [
  { key: "eventDate", prompt: "1. What is your preferred event date? Please use YYYY-MM-DD." },
  { key: "eventPurpose", prompt: "2. What is the event type or purpose?" },
  { key: "guests", prompt: "3. How many guests are expected?" },
  { key: "preferredVenueSetup", prompt: `4. Which venue and setup do you prefer? Setups: ${SETUPS.join(", ")}. Venues: Orchid, Magnolia 1, Magnolia 2, Opera, Palm 1, Palm 2.` },
  { key: "eventTiming", prompt: "5. What are the event start and end times?" },
  { key: "menuPreference", prompt: "6. Which menu preference do you need: Breakfast, Morning Tea, Lunch, Hi-Tea, or Dinner?" },
  { key: "avNeeds", prompt: "7. What AV do you need (projector, screen, sound system, microphone, etc.)?" },
  { key: "seatingArrangement", prompt: "8. Please describe the seating arrangement." },
  { key: "companyName", prompt: "9. What is your company or organization name?" },
  { key: "contactPerson", prompt: "10. Please share the contact person's name and phone number." },
  { key: "specialRequirements", prompt: "11. Any special requirements?" },
];
const STAGES = [
  ["inquiry", "Inquiry"], ["interested", "Client interested"], ["event_details", "Event details"],
  ["hall_check", "Venue availability"], ["proposal", "Proposal & quotation"],
  ["advance_payment", "Advance payment"], ["agreement", "Agreement / contract"],
  ["cs_verification", "CS verification"], ["confirmed", "Booking confirmed"],
  ["reminder", "Pre-event reminder"], ["event_setup", "Event day setup"],
  ["executed", "Event executed"], ["feedback", "Thank-you & feedback"],
  ["follow_up", "Follow up later"], ["no_booking", "No booking"],
];
exports.getStages = (req, res) => res.json({ success: true, data: STAGES.map(([id, label]) => ({ id, label })) });
const TERMINAL = ["confirmed", "executed", "feedback", "no_booking"];
const dayDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
const restaurantFor = (req) => req.admin?.restaurantId || req.body?.restaurantId || req.query?.restaurantId || RESTAURANT_ID;
const requireApiKey = (req, res) => {
  if (process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return false;
  }
  return true;
};
const populated = (query) => query.populate("hallId", "name capacity corporateRentalPrice setupOptions venueType");
const notifyNewCorporateEnquiry = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `new_corporate_enquiry:${booking._id}`,
  type: "new_booking",
  title: "New corporate event enquiry",
  message: `${booking.customerName || booking.customerPhone} · Corporate event`,
  entityType: "corporate_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("New corporate enquiry dashboard notification failed:", error));
const notifyCustomerDeclined = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `customer_declined:corporate:${booking._id}:${booking.updatedAt?.getTime() || Date.now()}`,
  type: "customer_declined",
  title: "Customer did not proceed with corporate event",
  message: `${booking.customerName || booking.customerPhone} · ${booking.stageHistory?.[booking.stageHistory.length - 1]?.note || "Customer declined the proposed options."}`,
  entityType: "corporate_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("Corporate decline dashboard notification failed:", error));
const notifyCustomerAgreed = (req, booking) => publishDashboardNotification(req, {
  restaurantId: booking.restaurantId,
  sourceKey: `customer_agreed:corporate:${booking._id}:${booking.updatedAt?.getTime() || Date.now()}`,
  type: "customer_agreed",
  title: "Customer agreed to proceed with corporate options",
  message: `${booking.customerName || booking.customerPhone} · ${booking.hallName || "Venue"} · ${booking.answers.eventDate || "Date to confirm"}`,
  entityType: "corporate_booking",
  entityId: String(booking._id),
}).catch((error) => console.error("Corporate agreement dashboard notification failed:", error));
const hallQuery = (group) => group === "boardrooms"
  ? { venueType: "boardroom" }
  : { venueType: "wedding_hall" };
const VENUE_ORDER = ["Orchid Hall", "Magnolia Hall 1", "Magnolia Hall 2", "Opera", "Palm 1", "Palm 2"];
const sortVenues = (venues) => venues.sort((left, right) => VENUE_ORDER.indexOf(left.name) - VENUE_ORDER.indexOf(right.name));
const eventDateFor = (booking) => booking.acceptedAlternateDate || booking.answers.eventDate;

async function dateRows(restaurantId, date, group = "all") {
  const [venues, rows] = await Promise.all([
    WeddingHall.find({ restaurantId, isActive: true, ...hallQuery(group) }).lean(),
    WeddingHallDate.find({ restaurantId, date }).lean(),
  ]);
  const byVenue = new Map(rows.map((row) => [String(row.hallId), row]));
  return sortVenues(venues).map((venue) => {
    const row = byVenue.get(String(venue._id));
    return {
      hallId: venue._id, hallName: venue.name, capacity: venue.capacity,
      rentalPrice: venue.corporateRentalPrice, setupOptions: venue.setupOptions || [],
      venueType: venue.venueType, isActive: venue.isActive,
      status: row?.status || "available", note: row?.note || "",
      bookingId: row?.bookingId || null,
    };
  });
}

function stage(booking, next, admin, note) {
  booking.stage = next;
  booking.stageHistory.push({
    stage: next, changedBy: admin?._id || null,
    actorName: admin?.name || admin?.email || "WhatsApp AI",
    note: String(note || "").slice(0, 500),
  });
}

function requestedVenueName(answer) {
  const normalized = String(answer || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/\borchid(?:\s+hall)?\b/.test(normalized)) return "Orchid Hall";
  const magnolia = normalized.match(/\bmagnolia(?:\s+hall)?\s*([12])\b/);
  if (magnolia) return `Magnolia Hall ${magnolia[1]}`;
  if (/\bopera\b/.test(normalized)) return "Opera";
  const palm = normalized.match(/\bpalm\s*([12])\b/);
  return palm ? `Palm ${palm[1]}` : "";
}

async function suggestions(restaurantId, fromDate, group, guests, limit = 5, setupType = "") {
  const venues = sortVenues(await WeddingHall.find({ restaurantId, isActive: true, ...hallQuery(group) }).lean());
  const end = new Date(fromDate);
  end.setUTCDate(end.getUTCDate() + 180);
  const rows = await WeddingHallDate.find({
    restaurantId, hallId: { $in: venues.map((venue) => venue._id) },
    date: { $gte: fromDate, $lt: end }, status: { $in: ["booked", "blocked"] },
  }).select("hallId date").lean();
  const unavailable = new Set(rows.map((row) => `${String(row.hallId)}:${dateKey(row.date)}`));
  const results = [];
  for (let offset = 0; offset < 180 && results.length < limit; offset += 1) {
    const date = new Date(fromDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const open = venues.filter((venue) =>
      venue.capacity != null && venue.capacity >= guests &&
      (!setupType || (venue.setupOptions || []).includes(setupType)) &&
      !unavailable.has(`${String(venue._id)}:${dateKey(date)}`)
    );
    if (open.length) results.push({
      date: dateKey(date),
      venues: open.map((venue) => ({
        hallId: venue._id, hallName: venue.name, capacity: venue.capacity,
        capacityConfirmed: venue.capacity != null, setupOptions: venue.setupOptions || [],
      })),
    });
  }
  return results;
}

exports.getQuestions = (req, res) => res.json({
  success: true,
  data: { greeting: CORPORATE_INTRO, questions: QUESTIONS.map((item, index) => ({ index, ...item })), completionMessage: CORPORATE_FINISH },
});

exports.getVenues = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const filter = req.query.group === "boardrooms" ? hallQuery("boardrooms") : hallQuery("corporate_halls");
    const venues = await WeddingHall.find({
      restaurantId: restaurantFor(req),
      ...(req.query.includeInactive === "true" ? {} : { isActive: true }),
      ...filter,
    }).lean();
    sortVenues(venues);
    res.json({ success: true, data: venues });
  } catch (error) {
    console.error("getCorporateVenues error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateVenue = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.hallId)) return res.status(400).json({ success: false, message: "Invalid venue id." });
    const venue = await WeddingHall.findOne({ _id: req.params.hallId, restaurantId: req.admin.restaurantId });
    if (!venue) return res.status(404).json({ success: false, message: "Corporate venue not found." });
    const { capacity, corporateRentalPrice, setupOptions, isActive } = req.body;
    if (capacity !== undefined && capacity !== null && capacity !== "" && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) {
      return res.status(400).json({ success: false, message: "Capacity must be a positive whole number or blank if not yet known." });
    }
    if (corporateRentalPrice !== undefined && corporateRentalPrice !== null && corporateRentalPrice !== "" && (!Number.isFinite(Number(corporateRentalPrice)) || Number(corporateRentalPrice) < 0)) {
      return res.status(400).json({ success: false, message: "Corporate venue rate must be non-negative or blank if not yet set." });
    }
    if (setupOptions !== undefined && (!Array.isArray(setupOptions) || setupOptions.some((item) => !SETUPS.includes(item)))) {
      return res.status(400).json({ success: false, message: "Choose only supported setup options." });
    }
    if (capacity !== undefined) venue.capacity = capacity === "" || capacity === null ? null : Number(capacity);
    if (corporateRentalPrice !== undefined) venue.corporateRentalPrice = corporateRentalPrice === "" || corporateRentalPrice === null ? null : Number(corporateRentalPrice);
    if (setupOptions !== undefined) venue.setupOptions = setupOptions;
    if (isActive !== undefined) venue.isActive = isActive !== false;
    await venue.save();
    res.json({ success: true, data: venue });
  } catch (error) {
    console.error("updateCorporateVenue error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getHallMonth = async (req, res) => {
  try {
    const match = String(req.query.month || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    const group = req.query.group === "boardrooms" ? "boardrooms" : "corporate_halls";
    if (!match) return res.status(400).json({ success: false, message: "month must use YYYY-MM." });
    const restaurantId = req.admin.restaurantId;
    const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
    const [venues, records] = await Promise.all([
      WeddingHall.find({ restaurantId, ...hallQuery(group) }).lean(),
      WeddingHallDate.find({ restaurantId, date: { $gte: start, $lt: end } }).lean(),
    ]);
    const byDate = new Map(records.map((row) => [`${row.hallId}:${dateKey(row.date)}`, row]));
    const days = [];
    for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      const key = dateKey(date);
      const halls = sortVenues(venues).map((venue) => {
        const row = byDate.get(`${venue._id}:${key}`);
        return {
          hallId: venue._id, hallName: venue.name, capacity: venue.capacity,
          rentalPrice: venue.corporateRentalPrice, setupOptions: venue.setupOptions || [],
          venueType: venue.venueType, isActive: venue.isActive,
          status: row?.status || "available", note: row?.note || "", bookingId: row?.bookingId || null,
        };
      });
      const statuses = halls.map((hall) => hall.status);
      const color = statuses.every((status) => status === "available") ? "all_available"
        : statuses.every((status) => status === "blocked") ? "all_blocked"
          : statuses[0] === "booked" && statuses.slice(1).every((status) => status === "available") ? "first_booked"
            : statuses[1] === "booked" && statuses.filter((_, index) => index !== 1).every((status) => status === "available") ? "second_booked"
              : statuses[2] === "booked" && statuses.slice(0, 2).every((status) => status === "available") ? "third_booked" : "mixed";
      days.push({ date: key, color, halls });
    }
    res.json({ success: true, data: { month: req.query.month, group, halls: venues, days } });
  } catch (error) {
    console.error("getCorporateHallMonth error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateHallDate = async (req, res) => {
  try {
    const date = dayDate(String(req.body.date || ""));
    const { hallId, status } = req.body;
    if (!date) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    if (!mongoose.isValidObjectId(hallId)) return res.status(400).json({ success: false, message: "A valid venue id is required." });
    if (!["available", "booked", "blocked"].includes(status)) return res.status(400).json({ success: false, message: "status must be available, booked or blocked." });
    const venue = await WeddingHall.findOne({ _id: hallId, restaurantId: req.admin.restaurantId, isActive: true });
    if (!venue) return res.status(404).json({ success: false, message: "Active corporate venue not found." });
    const current = await WeddingHallDate.findOne({ restaurantId: req.admin.restaurantId, hallId, date });
    if (current?.bookingId && current.status === "booked" && status !== "booked") return res.status(409).json({ success: false, message: "A confirmed event owns this date. Cancel the booking before changing availability." });
    const row = await WeddingHallDate.findOneAndUpdate(
      { restaurantId: req.admin.restaurantId, hallId, date },
      { status, note: String(req.body.note || "").slice(0, 500), updatedBy: req.admin._id, ...(status === "available" ? { bookingId: null } : {}) },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({ success: true, data: row });
  } catch (error) {
    console.error("updateCorporateHallDate error:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.message });
  }
};

exports.checkAvailability = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const params = req.method === "GET" ? req.query : req.body;
    const date = dayDate(String(params.date || ""));
    const guests = Math.max(0, Number(params.guests) || 0);
    const group = params.group === "boardrooms" ? "boardrooms" : "corporate_halls";
    const setupType = String(params.setupType || "").trim();
    if (setupType && !SETUPS.includes(setupType)) return res.status(400).json({ success: false, message: `setupType must be one of: ${SETUPS.join(", ")}.` });
    if (!date) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    const rows = await dateRows(restaurantFor(req), date, group);
    const requested = params.hallId || params.venue || params.hallName;
    const selected = requested ? rows.find((row) => String(row.hallId) === String(requested) || row.hallName.toLowerCase() === String(requested).toLowerCase()) : null;
    if (requested && !selected) return res.status(404).json({ success: false, message: "Corporate venue not found." });
    const candidates = (selected ? [selected] : rows).filter((row) =>
      row.status === "available" && row.capacity != null && (!guests || row.capacity >= guests) &&
      (!setupType || row.setupOptions.includes(setupType))
    ).map((row) => ({ ...row, capacityConfirmed: row.capacity != null }));
    res.json({ success: true, available: candidates.length > 0, data: { date: dateKey(date), guests, venues: rows, availableVenues: candidates } });
  } catch (error) {
    console.error("checkCorporateAvailability error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.suggestDates = async (req, res) => {
  try {
    if (!req.admin && !requireApiKey(req, res)) return;
    const fromDate = dayDate(String(req.query.fromDate || ""));
    if (!fromDate) return res.status(400).json({ success: false, message: "fromDate must be a valid YYYY-MM-DD date." });
    const group = req.query.group === "boardrooms" ? "boardrooms" : "corporate_halls";
    const guests = Math.max(0, Number(req.query.guests) || 0);
    const venueId = req.query.hallId || req.query.venueId || "";
    if (venueId && !mongoose.isValidObjectId(venueId)) return res.status(400).json({ success: false, message: "Invalid venue id." });
    const setupType = String(req.query.setupType || "").trim();
    if (setupType && !SETUPS.includes(setupType)) return res.status(400).json({ success: false, message: `setupType must be one of: ${SETUPS.join(", ")}.` });
    const rows = await suggestions(restaurantFor(req), fromDate, group, guests, Math.min(30, Math.max(1, Number(req.query.limit) || 5)), setupType);
    res.json({ success: true, data: venueId ? rows.map((row) => ({ ...row, venues: row.venues.filter((venue) => String(venue.hallId) === venueId) })).filter((row) => row.venues.length) : rows });
  } catch (error) {
    console.error("suggestCorporateDates error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const query = { restaurantId: req.admin.restaurantId, bookingType: "corporate" };
    if (req.query.stage && STAGES.some(([id]) => id === req.query.stage)) query.stage = req.query.stage;
    const data = await populated(WeddingBooking.find(query).sort({ updatedAt: -1 })).lean();
    res.json({ success: true, data });
  } catch (error) {
    console.error("getCorporateBookings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid booking id." });
    const booking = await populated(WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" }));
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    res.json({ success: true, data: booking });
  } catch (error) {
    console.error("getCorporateBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const customerPhone = String(req.body.customerPhone || "").trim();
    if (!customerPhone) return res.status(400).json({ success: false, message: "Contact phone is required." });
    const booking = await WeddingBooking.create({
      restaurantId: req.admin.restaurantId, bookingType: "corporate", customerPhone,
      customerName: String(req.body.customerName || "").trim(),
      source: "crm", stage: "inquiry",
      stageHistory: [{ stage: "inquiry", changedBy: req.admin._id, actorName: req.admin.name || "CRM staff", note: "Corporate inquiry created in CRM." }],
      answers: req.body.answers || {},
    });
    void notifyNewCorporateEnquiry(req, booking);
    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    console.error("createCorporateBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    const previousStage = booking.stage;
    for (const key of ["customerName", "customerPhone", "customerEmail", "answers", "hallId", "hallName", "setupType", "alternateDates", "acceptedAlternateDate", "paymentProofUrl", "agreementUrl", "eventExecutionNotes", "feedback"]) {
      if (req.body[key] !== undefined) booking[key] = req.body[key];
    }
    if (req.body.stage && req.body.stage !== booking.stage) {
      if (!STAGES.some(([id]) => id === req.body.stage) || req.body.stage === "confirmed") return res.status(400).json({ success: false, message: "Use a valid corporate workflow stage; use confirm endpoint for confirmation." });
      stage(booking, req.body.stage, req.admin, String(req.body.stageNote || ""));
    }
    if (req.body.paymentProofUrl !== undefined && req.body.paymentProofUrl !== booking.paymentProofUrl) {
      booking.paymentVerified = false;
      booking.paymentStatus = req.body.paymentProofUrl ? "proof_received" : "unpaid";
    }
    await booking.save();
    if (booking.stage === "no_booking" && previousStage !== "no_booking") void notifyCustomerDeclined(req, booking);
    res.json({ success: true, data: await populated(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("updateCorporateBooking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateStage = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    const previousStage = booking.stage;
    let { stage: next, note } = req.body;
    if (!STAGES.some(([id]) => id === next) || next === "confirmed") return res.status(400).json({ success: false, message: "Use a valid corporate workflow stage." });
    const rejectingPaymentProof = req.body.paymentProofRejection === true;
    if (rejectingPaymentProof) {
      note = String(note || "").trim();
      if (!booking.paymentProofUrl || booking.paymentVerified) return res.status(409).json({ success: false, message: "An unverified payment proof is required before rejection." });
      if (!note) return res.status(400).json({ success: false, message: "A reason is required to reject payment proof." });
      booking.paymentStatus = "rejected";
      booking.paymentProofRejectionReason = note.slice(0, 500);
      booking.paymentProofConfirmedByCustomer = false;
      next = "no_booking";
      note = `Payment proof rejected: ${note.slice(0, 450)}`;
    }
    if (next === "no_booking" && booking.stage === "confirmed") await releaseVenue(booking);
    if (next === "interested" && req.body.interested === false) stage(booking, "follow_up", req.admin, note || "Client requested follow up later.");
    else stage(booking, next, req.admin, note || "");
    await booking.save();
    if (booking.stage === "no_booking" && previousStage !== "no_booking" && !rejectingPaymentProof) void notifyCustomerDeclined(req, booking);
    res.json({ success: true, data: await populated(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("updateCorporateStage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createQuotation = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    const guests = Number(req.body.guests ?? booking.answers.guests);
    if (!Number.isInteger(guests) || guests < 1) return res.status(400).json({ success: false, message: "A positive guest count is required." });
    const menu = await Menu.findOne({ restaurantId: req.admin.restaurantId, category: "Corporate", isActive: true }).lean();
    if (!menu) return res.status(409).json({ success: false, message: "Enable and configure the Corporate menu before creating a quotation." });
    const venue = await WeddingHall.findOne({ _id: req.body.hallId || booking.hallId, restaurantId: req.admin.restaurantId, isActive: true });
    if (!venue) return res.status(400).json({ success: false, message: "Select an active corporate hall or board room." });
    if (venue.capacity == null) return res.status(409).json({ success: false, message: `Set a verified capacity for ${venue.name} before quoting/confirming.` });
    if (guests > venue.capacity) return res.status(400).json({ success: false, message: `${venue.name} capacity is ${venue.capacity}; the booking has ${guests} guests.` });
    if (venue.corporateRentalPrice == null) return res.status(409).json({ success: false, message: `Enter the approved corporate rate for ${venue.name} before calculating the quotation.` });
    const configuredTax = req.body.taxPercent ?? menu.corporateTaxPercent;
    if (configuredTax === null || configuredTax === undefined || configuredTax === "") return res.status(409).json({ success: false, message: "Set the approved corporate tax percentage in the Corporate menu before calculating the quotation." });
    const taxPercent = Number(configuredTax);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) return res.status(400).json({ success: false, message: "Tax percentage must be between 0 and 100." });
    const menuSubtotal = Math.round(Number(menu.price) * guests * 100) / 100;
    const venueRent = Number(venue.corporateRentalPrice);
    const subtotal = menuSubtotal + venueRent;
    const taxAmount = Math.round(subtotal * taxPercent) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    booking.answers.guests = guests;
    booking.hallId = venue._id;
    booking.hallName = venue.name;
    booking.setupType = String(req.body.setupType || booking.answers.preferredVenueSetup || "").slice(0, 120);
    booking.selectedMenuName = menu.title;
    booking.packageName = "Corporate Menu";
    booking.quotation = {
      guests, menuPricePerPerson: menu.price, menuSubtotal, hallRental: venueRent,
      decorCost: 0, addOns: [], discount: 0, taxPercent, taxAmount, total,
      advanceRequired: Math.round(total * 0.2 * 100) / 100,
      rulesApplied: [], notes: String(req.body.notes || ""), generatedAt: new Date(),
    };
    stage(booking, "proposal", req.admin, "Corporate quotation: configured menu price × guests + venue rate + approved tax.");
    await booking.save();
    res.json({ success: true, data: await populated(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("createCorporateQuotation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    if (!booking.paymentProofUrl) return res.status(409).json({ success: false, message: "Add the customer's advance payment proof before verification." });
    if (booking.paymentProofConfirmedByCustomer === false) return res.status(409).json({ success: false, message: "Wait for the customer to confirm the submitted payment proof before verification." });
    booking.paymentVerified = true;
    booking.paymentStatus = "verified";
    booking.paymentVerifiedAt = new Date();
    booking.paymentVerifiedBy = req.admin._id;
    stage(booking, "cs_verification", req.admin, "CS verified the advance payment proof.");
    await booking.save();
    res.json({ success: true, data: await populated(WeddingBooking.findById(booking._id)) });
  } catch (error) {
    console.error("verifyCorporatePayment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function reserveVenue(booking, admin) {
  const date = dayDate(eventDateFor(booking));
  if (!date || !booking.hallId) throw new Error("Select a corporate venue and valid event date first.");
  const venue = await WeddingHall.findOne({ _id: booking.hallId, restaurantId: booking.restaurantId, isActive: true });
  if (!venue || venue.capacity == null || venue.corporateRentalPrice == null) throw new Error("Set the venue's verified capacity and corporate rate before confirmation.");
  if (Number(booking.quotation.guests || booking.answers.guests || 0) > venue.capacity) throw new Error(`${venue.name} capacity is ${venue.capacity}; choose a suitable venue.`);
  const saved = await WeddingHallDate.findOneAndUpdate(
    { restaurantId: booking.restaurantId, hallId: venue._id, date, status: "available" },
    { $set: { status: "booked", bookingId: booking._id, updatedBy: admin._id, note: "Reserved by confirmed corporate event." } },
    { new: true },
  );
  if (saved) return;
  const existing = await WeddingHallDate.findOne({ restaurantId: booking.restaurantId, hallId: venue._id, date });
  if (existing?.status === "booked" && String(existing.bookingId) === String(booking._id)) return;
  if (!existing) {
    try {
      await WeddingHallDate.create({ restaurantId: booking.restaurantId, hallId: venue._id, date, status: "booked", bookingId: booking._id, updatedBy: admin._id, note: "Reserved by confirmed corporate event." });
      return;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  throw new Error("The selected venue/date is no longer available. Check the calendar and offer another option.");
}

async function releaseVenue(booking) {
  const date = dayDate(eventDateFor(booking));
  if (!date || !booking.hallId) return;
  await WeddingHallDate.updateOne(
    { restaurantId: booking.restaurantId, hallId: booking.hallId, date, bookingId: booking._id, status: "booked" },
    { $set: { status: "available", bookingId: null, note: "Released after corporate booking closure." } },
  );
}

exports.confirmBooking = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    if (booking.stage === "confirmed" && booking.confirmationMessageStatus !== "failed") return res.status(409).json({ success: false, message: "Corporate event is already confirmed." });
    if (!booking.paymentVerified) return res.status(409).json({ success: false, message: "CS must verify the advance payment first." });
    if (!booking.agreementUrl) return res.status(409).json({ success: false, message: "Save the signed agreement/contract before confirmation." });
    await reserveVenue(booking, req.admin);
    booking.answers.eventDate = eventDateFor(booking);
    stage(booking, "confirmed", req.admin, "Advance and agreement verified; shared venue/date inventory reserved.");
    await booking.save();
    const date = eventDateFor(booking);
    const message = [
      `Dear ${booking.customerName || booking.answers.contactPerson || "Customer"},`,
      "", "Your corporate event at Hotel d'GATES is confirmed.",
      `Company: ${booking.answers.companyName || "As agreed"}`,
      `Purpose: ${booking.answers.eventPurpose || "Corporate event"}`,
      `Venue: ${booking.hallName} · ${booking.setupType || "Setup as agreed"}`,
      `Date: ${date}`,
      `Time: ${booking.answers.eventTiming || "As agreed"}`,
      `Guests: ${booking.quotation.guests || booking.answers.guests}`,
      `Menu: ${booking.selectedMenuName || "Corporate Menu"}`,
      `Advance verified: Rs ${Number(booking.quotation.advanceRequired || 0).toLocaleString("en-PK")}`,
      "", "Thank you for choosing Hotel d'GATES. We look forward to hosting your event.",
    ].join("\n");
    let warning = "";
    try {
      if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) throw new Error("WhatsApp Cloud API credentials are not configured.");
      await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", to: booking.customerPhone.replace(/\D/g, ""),
        type: "text", text: { body: message },
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" } });
      booking.confirmationMessageStatus = "sent";
      booking.confirmationMessageError = "";
    } catch (error) {
      const reason = error.response?.data?.error?.message || error.message;
      booking.confirmationMessageStatus = "failed";
      booking.confirmationMessageError = reason.slice(0, 500);
      warning = `Corporate event confirmed, but WhatsApp delivery failed: ${reason}. Please resend in Chat History using Agent mode.`;
    }
    try {
      await Chat.create({
        restaurantId: booking.restaurantId, customerPhone: booking.customerPhone,
        customerName: booking.customerName || booking.answers.contactPerson || "WhatsApp Customer",
        botReply: message, sender: "admin", direction: "admin_to_customer",
        source: "corporate_booking_confirmation", status: warning ? "failed" : "sent",
        isBookingRelated: true, metadata: { corporateBookingId: String(booking._id), bookingType: "corporate", error: booking.confirmationMessageError },
      });
    } catch (error) {
      console.error("Could not log corporate confirmation to chat history:", error.message);
      warning = [warning, `Corporate event confirmed, but its WhatsApp message could not be added to Chat History: ${error.message}`].filter(Boolean).join(" ");
    }
    const eventDate = dayDate(date);
    const reminderAt = eventDate ? new Date(eventDate) : null;
    if (reminderAt) reminderAt.setUTCDate(reminderAt.getUTCDate() - 1);
    if (reminderAt) reminderAt.setUTCHours(5, 0, 0, 0);
    let reminderWarning = "";
    if (reminderAt && reminderAt > new Date()) {
      let reminder;
      try {
        reminder = await Reminder.create({
          restaurantId: booking.restaurantId, fromNumber: booking.customerPhone.replace(/\D/g, ""),
          customerName: booking.customerName || booking.answers.contactPerson,
          reason: "booking_later", reminderDate: reminderAt.toISOString().slice(0, 10),
          reminderTime: "10:00 AM", reminderAt,
          customerMessage: `Your corporate event at Hotel d'GATES is tomorrow. Our team is preparing the venue setup, AV and catering.`,
          source: `corporate_booking:${booking._id}`,
        });
        const job = await scheduleJob(reminder._id, reminderAt);
        reminder.jobId = String(job.id);
        await reminder.save();
        booking.reminderScheduledAt = reminderAt;
        booking.reminderWarning = "";
      } catch (error) {
        if (reminder) await Reminder.deleteOne({ _id: reminder._id });
        console.error("Could not schedule corporate event reminder:", error.message);
        reminderWarning = `Corporate event confirmed, but its reminder could not be scheduled: ${error.message}`;
        booking.reminderWarning = reminderWarning;
      }
    } else reminderWarning = booking.reminderWarning = !reminderAt
      ? "Reminder not scheduled because the event date is invalid."
      : "Reminder not scheduled because its send time has passed.";
    await booking.save();
    res.json({ success: true, data: await populated(WeddingBooking.findById(booking._id)), ...(warning || reminderWarning ? { warning: [warning, reminderWarning].filter(Boolean).join(" ") } : {}) });
  } catch (error) {
    console.error("confirmCorporateBooking error:", error);
    res.status(409).json({ success: false, message: error.message });
  }
};

exports.reviewAiReply = async (req, res) => {
  try {
    const booking = await WeddingBooking.findOne({ _id: req.params.id, restaurantId: req.admin.restaurantId, bookingType: "corporate" });
    if (!booking) return res.status(404).json({ success: false, message: "Corporate booking not found." });
    const reply = booking.aiReplies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ success: false, message: "AI reply not found." });
    reply.reviewed = req.body.reviewed !== false;
    await booking.save();
    res.json({ success: true, data: reply });
  } catch (error) {
    console.error("reviewCorporateAiReply error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.handleEnquiryFlow = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const customerPhone = String(req.body.customerPhone || "").trim();
    const message = String(req.body.message || "").trim();
    if (!customerPhone || !message) return res.status(400).json({ success: false, message: "customerPhone and message are required." });
    const restaurantId = restaurantFor(req);
    let booking = await WeddingBooking.findOne({
      restaurantId, customerPhone, bookingType: "corporate",
      stage: { $nin: TERMINAL.concat(["follow_up"]) },
      $or: [{ currentQuestionIndex: { $lt: QUESTIONS.length } }, { awaitingHallChoice: true }],
    }).sort({ createdAt: -1 });
    if (!booking && req.body.isCorporateStart !== true) return res.json({ success: true, data: { active: false, replyText: "" } });
    if (!booking) {
      const menu = await Menu.findOne({ restaurantId, category: "Corporate", isActive: true }).lean();
      if (!menu) return res.status(409).json({ success: false, message: "Corporate menu is disabled or not configured." });
      booking = await WeddingBooking.create({
        restaurantId, bookingType: "corporate", customerPhone,
        customerName: String(req.body.customerName || "").slice(0, 160),
        source: "whatsapp", stage: "inquiry", currentQuestionIndex: 0,
        stageHistory: [{ stage: "inquiry", actorName: "WhatsApp AI", note: "Corporate event enquiry started from WhatsApp." }],
      });
      void notifyNewCorporateEnquiry(req, booking);
      const replyText = `${CORPORATE_INTRO}\n\n${QUESTIONS[0].prompt}`;
      booking.aiReplies.push({ questionIndex: -1, text: CORPORATE_INTRO }, { questionIndex: 0, text: QUESTIONS[0].prompt });
      await booking.save();
      return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex: 0, replyText, answers: booking.answers } });
    }
    if (booking.awaitingHallChoice) {
      if (/\b(no|decline|not interested|no booking)\b/i.test(message)) {
        booking.awaitingHallChoice = false;
        stage(booking, "no_booking", null, "Client declined suggested corporate venue/date options.");
        const replyText = "Thank you for letting us know. Please contact our team whenever you would like to explore another corporate event date.";
        booking.aiReplies.push({ questionIndex: QUESTIONS.length, text: replyText });
        await booking.save();
        void notifyCustomerDeclined(req, booking);
        return res.json({ success: true, data: { active: false, bookingId: booking._id, complete: true, replyText } });
      }
      const chosenDate = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] || booking.answers.eventDate;
      const allowedDates = [booking.answers.eventDate, ...booking.alternateDates];
      if (!dayDate(chosenDate) || !allowedDates.includes(chosenDate)) {
        const replyText = `Please select one of these suggested dates and name your preferred venue: ${allowedDates.filter(Boolean).join(", ")}.`;
        booking.aiReplies.push({ questionIndex: QUESTIONS.length, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: true, replyText } });
      }
      const group = /opera|palm/i.test(booking.answers.preferredVenueSetup) ? "boardrooms" : "corporate_halls";
      const venues = await dateRows(restaurantId, dayDate(chosenDate), group);
      const selectedName = requestedVenueName(message) || requestedVenueName(booking.answers.preferredVenueSetup);
      const setupType = SETUPS.find((setup) => String(booking.answers.preferredVenueSetup || "").toLowerCase().includes(setup.toLowerCase())) || "";
      const available = venues.filter((venue) =>
        venue.status === "available" && venue.capacity != null && venue.capacity >= Number(booking.answers.guests || 0) &&
        (!selectedName || venue.hallName === selectedName) &&
        (!setupType || venue.setupOptions.includes(setupType))
      );
      const venue = available.find((item) => selectedName && item.hallName === selectedName)
        || (available.length === 1 ? available[0] : null);
      if (!venue) {
        const replyText = available.length
          ? `Please choose an available venue for ${chosenDate}: ${available.map((item) => `${item.hallName}${item.capacity == null ? " (capacity to be confirmed)" : ` (${item.capacity} guests)`}`).join(", ")}.`
          : `Those venue/date options are no longer available. Please contact our corporate events team for current alternatives.`;
        booking.alternateDates = [];
        if (!available.length) {
          const alternatives = await suggestions(restaurantId, dayDate(chosenDate), group, Number(booking.answers.guests || 0), 3, setupType);
          booking.alternateDates = alternatives.map((item) => item.date);
          booking.awaitingHallChoice = booking.alternateDates.length > 0;
        }
        booking.aiReplies.push({ questionIndex: QUESTIONS.length, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: booking.awaitingHallChoice, bookingId: booking._id, complete: true, replyText } });
      }
      booking.hallId = venue.hallId;
      booking.hallName = venue.hallName;
      booking.acceptedAlternateDate = chosenDate === booking.answers.eventDate ? "" : chosenDate;
      booking.awaitingHallChoice = false;
      stage(booking, "hall_check", null, `Selected ${venue.hallName} on ${chosenDate}; availability checked again.`);
      const replyText = `The ${venue.hallName} is available on ${chosenDate}${venue.capacity == null ? "; guest capacity still needs staff confirmation" : ` for ${booking.answers.guests} guests`}. ${CORPORATE_FINISH}`;
      booking.aiReplies.push({ questionIndex: QUESTIONS.length, text: replyText });
      await booking.save();
      void notifyCustomerAgreed(req, booking);
      return res.json({ success: true, data: { active: false, bookingId: booking._id, complete: true, replyText } });
    }

    const questionIndex = booking.currentQuestionIndex;
    const question = QUESTIONS[questionIndex];
    if (!question) return res.json({ success: true, data: { active: false, bookingId: booking._id, complete: true, replyText: CORPORATE_FINISH } });
    if (question.key === "eventDate") {
      const value = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
      if (!dayDate(value)) {
        const replyText = "Please provide the event date in YYYY-MM-DD format.";
        booking.aiReplies.push({ questionIndex, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText } });
      }
      booking.answers.eventDate = value;
    } else if (question.key === "guests") {
      const guests = Number(message.replace(/[^\d]/g, ""));
      if (!Number.isInteger(guests) || guests < 1) {
        const replyText = "Please provide a positive whole number of guests.";
        booking.aiReplies.push({ questionIndex, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText } });
      }
      booking.answers.guests = guests;
    } else if (question.key === "preferredVenueSetup") {
      const requestedSetup = SETUPS.find((setup) => message.toLowerCase().includes(setup.toLowerCase()));
      if (!requestedSetup) {
        const replyText = `Please include a setup choice: ${SETUPS.join(", ")}.`;
        booking.aiReplies.push({ questionIndex, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText } });
      }
      booking.answers.preferredVenueSetup = message.slice(0, 500);
      booking.setupType = requestedSetup;
    } else if (question.key === "menuPreference") {
      const menu = await Menu.findOne({ restaurantId, category: "Corporate", isActive: true }).lean();
      const preference = (menu?.corporateMenuPreferences || []).find((item) => message.toLowerCase().includes(item.toLowerCase()));
      if (!preference) {
        const replyText = `Please choose one menu preference: ${(menu?.corporateMenuPreferences || []).join(", ")}.`;
        booking.aiReplies.push({ questionIndex, text: replyText });
        await booking.save();
        return res.json({ success: true, data: { active: true, bookingId: booking._id, complete: false, questionIndex, replyText } });
      }
      booking.answers.menuPreference = preference;
    } else booking.answers[question.key] = message.slice(0, 1000);

    booking.currentQuestionIndex += 1;
    let replyText;
    let complete = booking.currentQuestionIndex >= QUESTIONS.length;
    if (!complete) {
      replyText = QUESTIONS[booking.currentQuestionIndex].prompt;
      booking.aiReplies.push({ questionIndex: booking.currentQuestionIndex, text: replyText });
    } else {
      stage(booking, "interested", null, "Corporate client completed the event enquiry.");
      stage(booking, "event_details", null, "All 11 corporate event details collected.");
      const date = dayDate(booking.answers.eventDate);
      const group = /opera|palm/i.test(booking.answers.preferredVenueSetup) ? "boardrooms" : "corporate_halls";
      const selectedName = requestedVenueName(booking.answers.preferredVenueSetup);
      const setupType = SETUPS.find((setup) => String(booking.answers.preferredVenueSetup || "").toLowerCase().includes(setup.toLowerCase())) || "";
      const available = date ? (await dateRows(restaurantId, date, group)).filter((venue) =>
        venue.status === "available" && venue.capacity != null && venue.capacity >= Number(booking.answers.guests || 0) &&
        (!selectedName || venue.hallName === selectedName) &&
        (!setupType || venue.setupOptions.includes(setupType))
      ) : [];
      const alternatives = date && !available.length ? await suggestions(restaurantId, date, group, Number(booking.answers.guests || 0), 3, setupType) : [];
      booking.alternateDates = alternatives.map((item) => item.date);
      booking.awaitingHallChoice = available.length > 0 || alternatives.length > 0;
      stage(booking, "hall_check", null, available.length ? "Requested date has venues with an open shared calendar slot." : "Requested date unavailable; alternate dates checked.");
      const menu = await Menu.findOne({ restaurantId, category: "Corporate", isActive: true }).lean();
      const menuLine = menu ? `${menu.title}: Rs ${Number(menu.price).toLocaleString("en-PK")} per person + tax.` : "Corporate menu is being confirmed by our team.";
      const venueLine = available.length
        ? `Available on ${booking.answers.eventDate}: ${available.map((item) => `${item.hallName}${item.capacity == null ? " (capacity confirmation required)" : ` (capacity ${item.capacity})`}`).join(", ")}.`
        : alternatives.length
          ? `No matching venue is open on ${booking.answers.eventDate}. Alternative dates: ${alternatives.map((item) => `${item.date} (${item.venues.map((venue) => venue.hallName).join(", ")})`).join("; ")}.`
          : `Our team will check venue availability for ${booking.answers.eventDate}.`;
      replyText = `${venueLine} ${menuLine} ${CORPORATE_FINISH}${booking.awaitingHallChoice ? " Please reply with your preferred date and venue." : ""}`;
      booking.aiReplies.push({ questionIndex: QUESTIONS.length, text: replyText });
    }
    await booking.save();
    res.json({ success: true, data: { active: booking.awaitingHallChoice || !complete, bookingId: booking._id, complete, questionIndex: booking.currentQuestionIndex, replyText, answers: booking.answers } });
  } catch (error) {
    console.error("handleCorporateEnquiryFlow error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
