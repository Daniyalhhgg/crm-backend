const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const RoomInventory = require("../models/RoomInventory");
const RoomType = require("../models/RoomType");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"];
const dateObject = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const dateKey = (date) => date.toISOString().slice(0, 10);
const datesBetween = (start, end) => {
  const dates = [];
  for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) dates.push(new Date(date));
  return dates;
};
const roomBooking = (booking) => Boolean(booking.roomTypeId || booking.checkOutDate) || /room|suite|accommodation/i.test(String(booking.package || ""));
const staysDuring = (booking, date) => {
  const checkIn = new Date(booking.bookingDate);
  const checkOut = booking.checkOutDate ? new Date(booking.checkOutDate) : new Date(checkIn.getTime() + 86400000);
  return date >= checkIn && date < checkOut;
};

async function getRoomAvailability({ restaurantId = "restaurant-1", checkInDate, checkOutDate, roomTypeId, rooms = 1, guests, excludeBookingId }) {
  const checkIn = dateObject(checkInDate);
  const checkOut = dateObject(checkOutDate);
  const roomCount = Number(rooms);
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    const error = new Error("checkInDate and checkOutDate must be valid dates, and check-out must be after check-in.");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 100) {
    const error = new Error("rooms must be a whole number from 1 to 100.");
    error.status = 400;
    throw error;
  }
  const guestCount = guests === undefined || guests === "" ? null : Number(guests);
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1)) {
    const error = new Error("guests must be a positive whole number.");
    error.status = 400;
    throw error;
  }
  if (!mongoose.isValidObjectId(roomTypeId)) {
    const error = new Error("A valid roomTypeId is required.");
    error.status = 400;
    throw error;
  }

  const roomType = await RoomType.findOne({ _id: roomTypeId, restaurantId, isActive: true }).lean();
  if (!roomType) {
    const error = new Error("The selected room type is not available.");
    error.status = 404;
    throw error;
  }
  if (guestCount && roomType.maxGuestsPerRoom && guestCount > Number(roomType.maxGuestsPerRoom) * roomCount) {
    const error = new Error(`${roomType.name} accommodates up to ${Number(roomType.maxGuestsPerRoom) * roomCount} guest(s) in ${roomCount} room(s).`);
    error.status = 409;
    throw error;
  }

  const dates = datesBetween(checkIn, checkOut);
  const [inventory, allBookings] = await Promise.all([
    RoomInventory.find({
      restaurantId,
      roomTypeId,
      date: { $gte: checkIn, $lt: checkOut },
    }).lean(),
    Booking.find({
      restaurantId,
      status: { $in: ACTIVE_STATUSES },
      bookingDate: { $lt: checkOut },
      $or: [{ checkOutDate: { $gt: checkIn } }, { checkOutDate: null }],
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
    }).select("package roomTypeId numberOfRooms bookingDate checkOutDate").lean(),
  ]);
  const inventoryByDate = new Map(inventory.map((item) => [dateKey(new Date(item.date)), item]));
  const relevantBookings = allBookings.filter((booking) => roomBooking(booking));
  const nights = dates.map((date) => {
    const key = dateKey(date);
    const reserved = relevantBookings
      .filter((booking) => staysDuring(booking, date) && (!booking.roomTypeId || String(booking.roomTypeId) === String(roomType._id)))
      .reduce((sum, booking) => sum + Math.max(1, Number(booking.numberOfRooms) || 1), 0);
    const blocked = Number(inventoryByDate.get(key)?.blockedRooms) || 0;
    const availableRooms = Math.max(0, Number(roomType.totalRooms) - reserved - blocked);
    return {
      date: key,
      totalRooms: Number(roomType.totalRooms),
      reservedRooms: reserved,
      blockedRooms: blocked,
      availableRooms,
      note: inventoryByDate.get(key)?.note || "",
      available: availableRooms >= roomCount,
    };
  });
  const unavailableNights = nights.filter((night) => !night.available);
  return {
    available: unavailableNights.length === 0,
    reason: unavailableNights.length ? `Only ${unavailableNights[0].availableRooms} ${roomType.name} room(s) are available on ${unavailableNights[0].date}.` : "",
    roomType: { _id: roomType._id, name: roomType.name, baseRate: roomType.baseRate, totalRooms: roomType.totalRooms, maxGuestsPerRoom: roomType.maxGuestsPerRoom || null },
    roomCount,
    checkInDate,
    checkOutDate,
    nights,
  };
}

module.exports = { getRoomAvailability, dateObject, dateKey, datesBetween, roomBooking };
