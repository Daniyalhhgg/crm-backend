const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const Menu = require("../models/Menu");
const { getFixedTimeSlots } = require("./fixedTimeSlots");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "checked_in"];
const menuCategoryForSlot = (category) => category === "Wedding" ? "Wedding Package" : category;

const dateObject = (date) => {
  if (typeof date !== "string" || !DATE_RE.test(date)) return null;
  const value = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date ? null : value;
};
const timeToMinutes = (value) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  }
  return hour * 60 + minute;
};
const formatDate = (date) => date.toISOString().slice(0, 10);
const currentDateTime = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.SLOT_TIMEZONE || "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  const hour = value("hour") === "24" ? "00" : value("hour");
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${hour}:${value("minute")}` };
};
const derivedStatus = (slot, remaining, total) => {
  if (slot.status === "full") return "full";
  if (remaining !== null && total > 0) {
    if (remaining <= 0) return "full";
    if ((total - remaining) / total >= 0.7) return "limited";
    return "available";
  }
  return slot.status || "available";
};

async function evaluateSlot({ restaurantId, date, category, slot, persons, excludeBookingId }) {
  const dayIsFull = slot.dayStatus === "full";
  const bookings = await Booking.find({
    restaurantId,
    bookingDate: dateObject(date),
    package: { $regex: packagePattern(category), $options: "i" },
    status: { $in: ACTIVE_BOOKING_STATUSES },
    ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  }).select("bookingTime numberOfPersons").lean();
  const from = timeToMinutes(slot.startTime);
  const to = timeToMinutes(slot.endTime);
  const overlappingBookings = bookings.filter((booking) => {
    const start = timeToMinutes(booking.bookingTime);
    if (start === null || from === null || to === null) return false;
    return start >= from && start < to;
  });
  const capacity = Math.max(0, Number(slot.capacity) || 0);
  const liveBooked = overlappingBookings.reduce((sum, booking) => sum + (Number(booking.numberOfPersons) || 0), 0);
  const booked = Math.max(Number(slot.booked) || 0, liveBooked);
  const seatsLeft = capacity > 0 ? Math.max(capacity - booked, 0) : null;
  let status = derivedStatus(slot, seatsLeft, capacity);
  if (dayIsFull) status = "full";
  const available = status !== "full" && (seatsLeft === null || seatsLeft >= persons);
  return {
    available,
    reason: available ? "" : dayIsFull ? "The day is marked full" : seatsLeft !== null && seatsLeft < persons ? "Not enough seats are available" : "No availability for this time",
    date,
    time: slot.startTime,
    slot: {
      id: slot._id,
      label: slot.label || "",
      startTime: slot.startTime,
      endTime: slot.endTime,
      status,
      capacity,
      booked,
      seatsLeft,
    },
    alternatives: [],
  };
}

function packagePattern(category) {
  if (category === "Pool/Gym") return "pool|gym|swim";
  const escaped = String(category || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (category === "Rooms") return "Room(\\s+Booking)?";
  return escaped;
}

async function checkAvailability({ restaurantId = "restaurant-1", date, time, persons = 1, category = "Hi-Tea Buffet", excludeBookingId, includeAlternatives = true }) {
  const dateObj = dateObject(date);
  const minute = timeToMinutes(time);
  const guestCount = Number(persons);
  if (!dateObj || typeof time !== "string" || !TIME_RE.test(time) || minute === null || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 10000) {
    const error = new Error("date, time, and persons must be valid (YYYY-MM-DD, HH:mm, positive integer)");
    error.status = 400;
    throw error;
  }
  const menu = await Menu.findOne({ restaurantId, category: menuCategoryForSlot(category) }).select("menuTimeSlots").lean();
  const configuredSlots = menu?.menuTimeSlots || [];
  const day = await Slot.findOne({ restaurantId, category, date: dateObj }).lean();
  const slots = getFixedTimeSlots(day?.timeSlots || [], day?.status, category, configuredSlots);
  const matched = slots.find((slot) => slot.startTime <= time && time < slot.endTime);
  const current = currentDateTime();
  const isPastToday = date === current.date && time <= current.time;
  if (!matched) {
    return {
      available: false,
      reason: isPastToday ? "This time slot has already started" : day?.status === "full" ? "The day is marked full" : "No time slot matches the requested time",
      date, time, slot: null, alternatives: includeAlternatives ? await alternatives(isPastToday ? current.time : undefined) : [],
    };
  }
  const result = await evaluateSlot({
    restaurantId, date, category, slot: { ...matched, dayStatus: day?.status }, persons: guestCount, excludeBookingId,
  });
  result.time = time;
  if (isPastToday) {
    result.available = false;
    result.reason = "This time slot has already started";
  }
  if (includeAlternatives && !result.available) result.alternatives = await alternatives(isPastToday ? current.time : undefined);
  return result;

  async function alternatives(afterTime) {
    const items = [];
    const otherSlots = slots
      .filter((candidate) => candidate.startTime > (afterTime || matched?.startTime || time))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const candidate of otherSlots) {
      const availability = await evaluateSlot({ restaurantId, date, category, slot: { ...candidate, dayStatus: day?.status }, persons: guestCount, excludeBookingId });
      if (availability.available) items.push({ ...availability.slot, date });
      if (items.length === 3) return items;
    }
    if (items.length) return items;
    for (let offset = 1; offset <= 3 && items.length < 3; offset++) {
      const nextDate = new Date(dateObj);
      nextDate.setUTCDate(nextDate.getUTCDate() + offset);
      const nextKey = formatDate(nextDate);
      const nextDay = await Slot.findOne({ restaurantId, category, date: nextDate }).lean();
      if (!nextDay || nextDay.status === "full") continue;
      const candidates = getFixedTimeSlots(nextDay.timeSlots || [], nextDay.status, category, configuredSlots);
      for (const candidate of candidates) {
        const availability = await evaluateSlot({ restaurantId, date: nextKey, category, slot: { ...candidate, dayStatus: nextDay.status }, persons: guestCount, excludeBookingId });
        if (availability.available) items.push({ ...availability.slot, date: nextKey });
        if (items.length === 3) break;
      }
    }
    return items;
  }
}

async function checkDateAvailability({ restaurantId = "restaurant-1", date, persons = 1, category = "Hi-Tea Buffet" }) {
  const dateObj = dateObject(date);
  const guestCount = Number(persons);
  if (!dateObj || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 10000) {
    const error = new Error("date and persons must be valid (YYYY-MM-DD and a positive integer)");
    error.status = 400;
    throw error;
  }

  const menu = await Menu.findOne({ restaurantId, category: menuCategoryForSlot(category) }).select("menuTimeSlots").lean();
  const configuredSlots = menu?.menuTimeSlots || [];
  const day = await Slot.findOne({ restaurantId, date: dateObj, category }).lean();
  const slots = await Promise.all(getFixedTimeSlots(day?.timeSlots || [], day?.status, category, configuredSlots).map(async (slot) => {
    const availability = await evaluateSlot({
      restaurantId,
      date,
      category,
      slot: { ...slot, dayStatus: day?.status },
      persons: guestCount,
    });
    return { ...availability.slot, available: availability.available, reason: availability.reason };
  }));

  return {
    date,
    category,
    persons: guestCount,
    configured: Boolean(day),
    dayStatus: day?.status || "available",
    openSlots: slots.filter((slot) => slot.available).length,
    timeSlots: slots,
  };
}

module.exports = { checkAvailability, checkDateAvailability, dateObject, timeToMinutes };
