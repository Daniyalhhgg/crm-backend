const Slot = require("../models/Slot");
const Menu = require("../models/Menu");
const { checkAvailability, checkDateAvailability, dateObject } = require("../services/availabilityService");
const { getCategoryTimeSlots } = require("../services/fixedTimeSlots");

const CATEGORIES = ["Hi-Tea Buffet", "Dinner Buffet", "Pool/Gym", "Wedding", "Rooms", "D'Fusion Revolving Restaurant: A La Carte Menu", "À la carte / Restaurant Reservation", "Auditorium / Movie Night + Hi-Tea"];
const STATUSES = ["available", "limited", "full"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DATES = 93;
const TZ = process.env.SLOT_TIMEZONE || "Asia/Karachi";
const menuCategoryForSlot = (category) => {
  if (category === "Wedding") return "Wedding Package";
  if (category === "D'Fusion") return "D'Fusion Revolving Restaurant: A La Carte Menu";
  return category;
};

/* ---------------- helpers ---------------- */

const parseDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

exports.getAvailability = async (req, res) => {
  try {
    const { date, time, persons, category = "Hi-Tea Buffet" } = req.query;
    const restaurantId = req.admin?.restaurantId || req.query.restaurantId || "restaurant-1";
    if (!req.admin && process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    if (!CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` });
    const data = await checkAvailability({ restaurantId, date, time, persons, category });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getDateAvailability = async (req, res) => {
  try {
    const { date, persons, category = "Hi-Tea Buffet" } = req.query;
    const restaurantId = req.admin?.restaurantId || req.query.restaurantId || "restaurant-1";
    if (!req.admin && process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` });
    }
    const data = await checkDateAvailability({ restaurantId, date, persons, category });
    const current = nowParts();
    if (date === current.date) {
      data.timeSlots = data.timeSlots.map((slot) => (
        slot.startTime <= current.time
          ? { ...slot, available: false, reason: "This time slot has already started" }
          : slot
      ));
      data.openSlots = data.timeSlots.filter((slot) => slot.available).length;
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getHiTeaSchedule = async (req, res) => {
  try {
    if (!req.admin && process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }
    const from = req.query.from || nowParts().date;
    const start = dateObject(from);
    const days = Number(req.query.days || 7);
    const restaurantId = req.admin?.restaurantId || req.query.restaurantId || "restaurant-1";
    if (!start) return res.status(400).json({ success: false, message: "from must be YYYY-MM-DD" });
    if (!Number.isInteger(days) || days < 1 || days > 31) return res.status(400).json({ success: false, message: "days must be an integer from 1 to 31" });
    const data = [];
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + offset);
      const dateKey = date.toISOString().slice(0, 10);
      const availability = await checkDateAvailability({
        restaurantId,
        date: dateKey,
        persons: 1,
        category: "Hi-Tea Buffet",
      });
      const day = await Slot.findOne({ restaurantId, date, category: "Hi-Tea Buffet" }).select("note").lean();
      data.push({ date: dateKey, status: availability.dayStatus, note: day?.note || "", timeSlots: availability.timeSlots });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error("getHiTeaSchedule error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// Return the current date and time in the restaurant timezone.
const nowParts = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  const hour = g("hour") === "24" ? "00" : g("hour");
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${hour}:${g("minute")}` };
};

const normalizeTime = (t) => {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const v = `${m[1].padStart(2, "0")}:${m[2]}`;
  return TIME_RE.test(v) ? v : null;
};

// Derive availability from capacity when configured; otherwise use the manual status.
const deriveStatus = (capacity, booked, manual) => {
  if (!(capacity > 0)) return manual;
  if (booked >= capacity) return "full";
  if (booked >= Math.ceil(capacity * 0.7)) return "limited";
  return "available";
};

const cleanTimeSlots = (input, category = "Hi-Tea Buffet", configuredLabels = []) => {
  const fixedSlots = getCategoryTimeSlots(category, configuredLabels);
  if (!Array.isArray(input)) return { error: "timeSlots must be an array" };
  if (input.length !== fixedSlots.length) return { error: `Exactly ${fixedSlots.length} fixed time slots are required for ${category}` };

  const out = [];
  for (const [index, t] of input.entries()) {
    const startTime = String(t?.startTime || "").trim();
    const endTime = String(t?.endTime || "").trim();
    const fixed = fixedSlots[index];
    if (!fixed) return { error: `No matching slot definition for ${category}` };
    if (startTime !== fixed.startTime || endTime !== fixed.endTime) {
      return { error: `Time slot ${index + 1} must be ${fixed.label}` };
    }
    const manual = t?.status || "available";
    const capacity = Math.floor(Number(t?.capacity) || 0);
    const booked = Math.floor(Number(t?.booked) || 0);

    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return { error: "Time must be in HH:mm (24h) format" };
    if (endTime <= startTime) return { error: `End time must be after start time (${startTime} - ${endTime})` };
    if (!STATUSES.includes(manual)) return { error: "time slot status must be: available | limited | full" };
    if (capacity < 0 || booked < 0 || capacity > 100000) return { error: "Invalid capacity / booked value" };
    if (capacity > 0 && booked > capacity) return { error: `Booked (${booked}) cannot be more than capacity (${capacity})` };

    out.push({
      label: fixed.label,
      startTime,
      endTime,
      status: deriveStatus(capacity, booked, manual),
      note: String(t?.note || "").trim().slice(0, 200),
      capacity,
      booked: capacity > 0 ? booked : 0,
    });
  }
  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { value: out };
};

const buildSet = ({ status, note, timeSlots }, adminId) => {
  const set = { updatedBy: adminId };
  if (status !== undefined) set.status = status;
  if (note !== undefined) set.note = String(note || "").trim();
  if (timeSlots !== undefined) set.timeSlots = timeSlots;
  return set;
};

const outTs = (t) => ({
  _id: t._id,
  label: t.label,
  startTime: t.startTime,
  endTime: t.endTime,
  status: t.status,
  note: t.note,
  capacity: t.capacity || 0,
  booked: t.booked || 0,
  seatsLeft: t.capacity > 0 ? Math.max(t.capacity - (t.booked || 0), 0) : null,
});

const serialize = (slot) => ({
  _id: slot._id,
  status: slot.status,
  note: slot.note,
  timeSlots: (slot.timeSlots || []).map(outTs),
  updatedAt: slot.updatedAt,
});

/* =============================================
   GET /api/slots?month=2026-10
   ============================================= */
exports.getSlotsByMonth = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const { month } = req.query;

    if (!/^\d{4}-\d{2}$/.test(month || "")) {
      return res.status(400).json({ success: false, message: "month query param required (YYYY-MM)" });
    }

    const [year, mon] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));

    const [slots, menus] = await Promise.all([
      Slot.find({ restaurantId, date: { $gte: start, $lt: end } }).lean(),
      Menu.find({ restaurantId, category: { $in: ["Hi-Tea Buffet", "Dinner Buffet", "Wedding Package"] } }).select("category menuTimeSlots").lean(),
    ]);

    const map = {};
    slots.forEach((slot) => {
      const dateKey = slot.date.toISOString().split("T")[0];
      if (!map[dateKey]) map[dateKey] = {};
      map[dateKey][slot.category] = serialize(slot);
    });

    const slotConfigs = Object.fromEntries(menus.map((menu) => [
      menu.category === "Wedding Package" ? "Wedding" : menu.category,
      getCategoryTimeSlots(menu.category === "Wedding Package" ? "Wedding" : menu.category, menu.menuTimeSlots || []),
    ]));
    res.json({ success: true, data: map, slotConfigs });
  } catch (error) {
    console.error("❌ getSlotsByMonth Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =============================================
   PUT /api/slots   (single category)
   Body: { date, category, status?, note?, timeSlots? }
   ============================================= */
exports.upsertSlot = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const { date, category, status, note, timeSlots } = req.body;

    const dateObj = parseDate(date);
    if (!dateObj) return res.status(400).json({ success: false, message: "date required (YYYY-MM-DD)" });
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` });
    }
    if (status === undefined && note === undefined && timeSlots === undefined) {
      return res.status(400).json({ success: false, message: "Nothing to update (status, note or timeSlots required)" });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "status must be: available | limited | full" });
    }

    let cleanTs;
    if (timeSlots !== undefined) {
      const menu = await Menu.findOne({ restaurantId, category: menuCategoryForSlot(category) }).select("menuTimeSlots").lean();
      const r = cleanTimeSlots(timeSlots, category, menu?.menuTimeSlots || []);
      if (r.error) return res.status(400).json({ success: false, message: r.error });
      cleanTs = r.value;
    }

    const slot = await Slot.findOneAndUpdate(
      { restaurantId, date: dateObj, category },
      { $set: buildSet({ status, note, timeSlots: cleanTs }, req.admin._id) },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const io = req.app.get("io");
    if (io) io.to("chat-admins").emit("slot_updated", { restaurantId, date, category, ...serialize(slot) });

    res.json({ success: true, data: serialize(slot) });
  } catch (error) {
    console.error("❌ upsertSlot Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =============================================
   PUT /api/slots/bulk
   Body: { date | dates:[...], slots: [ { category, status, note, timeSlots } ] }
   Providing dates applies the same settings to multiple days.
   ============================================= */
exports.bulkUpdateSlots = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const { date, dates, slots } = req.body;

    if (!Array.isArray(slots)) return res.status(400).json({ success: false, message: "slots[] required" });

    const list = [...new Set(Array.isArray(dates) && dates.length ? dates : [date])];
    if (list.length > MAX_DATES) return res.status(400).json({ success: false, message: `Maximum ${MAX_DATES} days at once` });
    const dateObjs = list.map(parseDate);
    if (!dateObjs.length || dateObjs.some((d) => !d)) {
      return res.status(400).json({ success: false, message: "valid date(s) required (YYYY-MM-DD)" });
    }

    // Validate every update before writing any of them.
    const prepared = [];
    const categories = [...new Set(slots.map((slot) => slot?.category).filter((category) => CATEGORIES.includes(category)))];
    const menuCategories = [...new Set(categories.map(menuCategoryForSlot))];
    const menus = await Menu.find({ restaurantId, category: { $in: menuCategories } }).select("category menuTimeSlots").lean();
    const configuredSlotsByCategory = Object.fromEntries(menus.map((menu) => [
      menu.category === "Wedding Package" ? "Wedding" : menu.category,
      menu.menuTimeSlots || [],
    ]));
    for (const s of slots) {
      if (!CATEGORIES.includes(s?.category)) continue;
      const status = s.status || "available";
      if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Invalid status for ${s.category}` });

      let cleanTs;
      if (s.timeSlots !== undefined) {
        const r = cleanTimeSlots(s.timeSlots, s.category, configuredSlotsByCategory[s.category] || []);
        if (r.error) return res.status(400).json({ success: false, message: `${s.category}: ${r.error}` });
        cleanTs = r.value;
      }
      prepared.push({ category: s.category, status, note: s.note ?? "", timeSlots: cleanTs });
    }

    const ops = [];
    for (const dateObj of dateObjs) {
      for (const p of prepared) {
        ops.push({
          updateOne: {
            filter: { restaurantId, date: dateObj, category: p.category },
            update: {
              $set: buildSet(p, req.admin._id),
              $setOnInsert: { restaurantId, date: dateObj, category: p.category },
            },
            upsert: true,
          },
        });
      }
    }
    if (ops.length) await Slot.bulkWrite(ops, { ordered: false });

    const io = req.app.get("io");
    if (io) io.to("chat-admins").emit("slots_bulk_updated", { restaurantId, dates: list });

    if (list.length > 1) return res.json({ success: true, updatedDays: list.length });

    const saved = await Slot.find({ restaurantId, date: dateObjs[0] }).lean();
    const map = {};
    saved.forEach((sl) => { map[sl.category] = serialize(sl); });
    res.json({ success: true, data: map });
  } catch (error) {
    console.error("❌ bulkUpdateSlots Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =============================================
   PUBLIC (WhatsApp bot / n8n)
   GET /api/slots/public
       ?date=2026-10-15        (defaults to today in the restaurant timezone)
       &time=17:30             (defaults to the current time when date is today)
       &category=Hi-Tea Buffet (optional)
       &restaurantId=restaurant-1
   Response includes status, timeSlots, activeSlot (the slot currently in progress),
   nextSlot, statusAtTime (available | limited | full | no_slot)
   ============================================= */
exports.getPublicSlots = async (req, res) => {
  try {
    const { restaurantId = "restaurant-1", category } = req.query;
    const now = nowParts();
    const date = req.query.date || now.date;

    const dateObj = parseDate(date);
    if (!dateObj) return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });

    let time = null;
    if (req.query.time) {
      time = normalizeTime(req.query.time);
      if (!time) return res.status(400).json({ success: false, message: "time must be HH:mm (24h)" });
    } else if (date === now.date) {
      time = now.time;
    }

    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` });
    }
    const cats = category ? [category] : CATEGORIES;

    const result = {};
    for (const cat of cats) {
      const availability = await checkDateAvailability({ restaurantId, date, persons: 1, category: cat });
      const f = await Slot.findOne({ restaurantId, date: dateObj, category: cat }).select("note").lean();
      const day = availability.dayStatus;
      const ts = availability.timeSlots.map((slot) => ({
        _id: slot.id,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: slot.status,
        note: slot.note,
        capacity: slot.capacity,
        booked: slot.booked,
        seatsLeft: slot.seatsLeft,
      }));
      const active = time ? ts.find((t) => t.startTime <= time && time < t.endTime) || null : null;
      const next = time ? ts.find((t) => t.startTime > time) || null : null;

      let statusAtTime;
      if (!time) statusAtTime = null;
      else if (day === "full") statusAtTime = "full";
      else statusAtTime = active ? active.status : "no_slot";

      result[cat] = { status: day, note: f?.note || "", configured: availability.configured, timeSlots: ts, activeSlot: active, nextSlot: next, statusAtTime };
    }

    res.json({ success: true, date, time, timezone: TZ, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};