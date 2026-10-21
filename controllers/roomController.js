const mongoose = require("mongoose");
const RoomInventory = require("../models/RoomInventory");
const RoomType = require("../models/RoomType");
const Booking = require("../models/Booking");
const { getRoomAvailability, dateObject, dateKey, roomBooking } = require("../services/roomAvailabilityService");

const requirePublicKey = (req, res) => {
  if (!req.admin && process.env.N8N_API_KEY && req.get("x-api-key") !== process.env.N8N_API_KEY) {
    res.status(401).json({ success: false, message: "Invalid API key" });
    return false;
  }
  return true;
};

const validateType = (body) => {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return "Room type name is required (100 characters max).";
  if (!Number.isFinite(Number(body.baseRate)) || Number(body.baseRate) < 0) return "baseRate must be a non-negative number.";
  if (!Number.isInteger(Number(body.totalRooms)) || Number(body.totalRooms) < 1 || Number(body.totalRooms) > 10000) return "totalRooms must be a whole number from 1 to 10000.";
  if (body.maxGuestsPerRoom !== undefined && body.maxGuestsPerRoom !== null && body.maxGuestsPerRoom !== "" && (!Number.isInteger(Number(body.maxGuestsPerRoom)) || Number(body.maxGuestsPerRoom) < 1 || Number(body.maxGuestsPerRoom) > 30)) return "maxGuestsPerRoom must be a whole number from 1 to 30.";
  if (body.amenities !== undefined && (!Array.isArray(body.amenities) || body.amenities.some((item) => typeof item !== "string"))) return "amenities must be an array of strings.";
  if (body.imageUrls !== undefined && (!Array.isArray(body.imageUrls) || body.imageUrls.some((item) => typeof item !== "string" || item.length > 2048))) return "imageUrls must be an array of URLs (2048 characters max each).";
  return null;
};

exports.getRoomTypes = async (req, res) => {
  try {
    if (!requirePublicKey(req, res)) return;
    const restaurantId = req.admin?.restaurantId || req.query.restaurantId || "restaurant-1";
    const query = { restaurantId };
    if (!req.query.includeInactive) query.isActive = true;
    const data = await RoomType.find(query).sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch (error) {
    console.error("getRoomTypes error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRoomType = async (req, res) => {
  try {
    const invalid = validateType(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const data = await RoomType.create({
      restaurantId: req.admin.restaurantId,
      name: req.body.name.trim(),
      description: String(req.body.description || "").trim(),
      baseRate: Number(req.body.baseRate),
      totalRooms: Number(req.body.totalRooms),
      maxGuestsPerRoom: req.body.maxGuestsPerRoom ? Number(req.body.maxGuestsPerRoom) : null,
      amenities: (req.body.amenities || []).map((item) => item.trim()).filter(Boolean),
      ...(req.body.imageUrls !== undefined ? { imageUrls: req.body.imageUrls.map((item) => item.trim()).filter(Boolean) } : {}),
      isActive: req.body.isActive !== false,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("createRoomType error:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.code === 11000 ? "A room type with this name already exists." : error.message });
  }
};

exports.updateRoomType = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid room type id." });
    const invalid = validateType(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const data = await RoomType.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.admin.restaurantId },
      {
        name: req.body.name.trim(),
        description: String(req.body.description || "").trim(),
        baseRate: Number(req.body.baseRate),
        totalRooms: Number(req.body.totalRooms),
        maxGuestsPerRoom: req.body.maxGuestsPerRoom ? Number(req.body.maxGuestsPerRoom) : null,
        amenities: (req.body.amenities || []).map((item) => item.trim()).filter(Boolean),
        ...(req.body.imageUrls !== undefined ? { imageUrls: req.body.imageUrls.map((item) => item.trim()).filter(Boolean) } : {}),
        isActive: req.body.isActive !== false,
      },
      { new: true, runValidators: true }
    );
    if (!data) return res.status(404).json({ success: false, message: "Room type not found." });
    res.json({ success: true, data });
  } catch (error) {
    console.error("updateRoomType error:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.code === 11000 ? "A room type with this name already exists." : error.message });
  }
};

exports.deleteRoomType = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid room type id." });
    const data = await RoomType.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.admin.restaurantId },
      { isActive: false },
      { new: true }
    );
    if (!data) return res.status(404).json({ success: false, message: "Room type not found." });
    res.json({ success: true, data });
  } catch (error) {
    console.error("deleteRoomType error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMonthAvailability = async (req, res) => {
  try {
    const monthMatch = String(req.query.month || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!monthMatch) return res.status(400).json({ success: false, message: "month must use YYYY-MM." });
    const restaurantId = req.admin.restaurantId;
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const [roomTypes, inventory, bookings] = await Promise.all([
      RoomType.find({ restaurantId }).sort({ name: 1 }).lean(),
      RoomInventory.find({ restaurantId, date: { $gte: start, $lt: end } }).lean(),
      Booking.find({
        restaurantId,
        status: { $in: ["pending", "pending_payment_verification", "confirmed", "checked_in"] },
        bookingDate: { $lt: end },
        $or: [{ checkOutDate: { $gt: start } }, { checkOutDate: null }],
      }).select("package roomTypeId numberOfRooms bookingDate checkOutDate").lean(),
    ]);
    const days = Array.from({ length: (end - start) / 86400000 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      return date;
    });
    const result = roomTypes.map((roomType) => ({
      ...roomType,
      days: days.map((date) => {
        const key = dateKey(date);
        const override = inventory.find((item) => String(item.roomTypeId) === String(roomType._id) && dateKey(new Date(item.date)) === key);
        const reservedRooms = bookings
          .filter((booking) => roomBooking(booking) && (!booking.roomTypeId || String(booking.roomTypeId) === String(roomType._id)) && date >= new Date(booking.bookingDate) && date < (booking.checkOutDate ? new Date(booking.checkOutDate) : new Date(new Date(booking.bookingDate).getTime() + 86400000)))
          .reduce((sum, booking) => sum + Math.max(1, Number(booking.numberOfRooms) || 1), 0);
        const blockedRooms = Number(override?.blockedRooms) || 0;
        const availableRooms = Math.max(0, Number(roomType.totalRooms) - reservedRooms - blockedRooms);
        return { date: key, totalRooms: Number(roomType.totalRooms), reservedRooms, blockedRooms, availableRooms, note: override?.note || "" };
      }),
    }));
    res.json({ success: true, data: { month: req.query.month, days: days.map(dateKey), roomTypes: result } });
  } catch (error) {
    console.error("getMonthAvailability error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateRoomInventory = async (req, res) => {
  try {
    const { date, roomTypeId } = req.body;
    const dateValue = dateObject(date);
    if (!dateValue) return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD date." });
    if (!mongoose.isValidObjectId(roomTypeId)) return res.status(400).json({ success: false, message: "A valid roomTypeId is required." });
    if (!Number.isInteger(Number(req.body.blockedRooms)) || Number(req.body.blockedRooms) < 0) return res.status(400).json({ success: false, message: "blockedRooms must be a non-negative whole number." });
    const roomType = await RoomType.findOne({ _id: roomTypeId, restaurantId: req.admin.restaurantId });
    if (!roomType) return res.status(404).json({ success: false, message: "Room type not found." });
    if (Number(req.body.blockedRooms) > roomType.totalRooms) return res.status(400).json({ success: false, message: "blockedRooms cannot exceed this room type's total inventory." });
    const data = await RoomInventory.findOneAndUpdate(
      { restaurantId: req.admin.restaurantId, roomTypeId, date: dateValue },
      { $set: { blockedRooms: Number(req.body.blockedRooms), note: String(req.body.note || "").trim().slice(0, 300), updatedBy: req.admin._id }, $setOnInsert: { restaurantId: req.admin.restaurantId, roomTypeId, date: dateValue } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, data });
  } catch (error) {
    console.error("updateRoomInventory error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkAvailability = async (req, res) => {
  try {
    if (!requirePublicKey(req, res)) return;
    const restaurantId = req.admin?.restaurantId || req.query.restaurantId || "restaurant-1";
    const request = {
      restaurantId,
      checkInDate: req.query.checkInDate,
      checkOutDate: req.query.checkOutDate,
      roomTypeId: req.query.roomTypeId,
      rooms: req.query.rooms || 1,
      guests: req.query.guests,
      guests: req.query.guests,
    };
    const data = await getRoomAvailability(request);
    if (!data.available) {
      const alternatives = [];
      const roomTypes = await RoomType.find({ restaurantId, isActive: true }).sort({ name: 1 }).lean();
      for (const roomType of roomTypes) {
        if (String(roomType._id) === String(request.roomTypeId)) continue;
        const option = await getRoomAvailability({ ...request, roomTypeId: roomType._id });
        if (option.available) alternatives.push({ roomTypeId: roomType._id, roomType: roomType.name, checkInDate: request.checkInDate, checkOutDate: request.checkOutDate, date: request.checkInDate, label: `${roomType.name} · ${request.checkInDate} to ${request.checkOutDate}` });
        if (alternatives.length === 3) break;
      }
      if (alternatives.length < 3) {
        const originalIn = dateObject(request.checkInDate);
        const originalOut = dateObject(request.checkOutDate);
        const nights = (originalOut - originalIn) / 86400000;
        const selectedRoomType = roomTypes.find((item) => String(item._id) === String(request.roomTypeId));
        if (selectedRoomType) {
          for (let offset = 1; offset <= 7 && alternatives.length < 3; offset += 1) {
            const nextIn = new Date(originalIn);
            nextIn.setUTCDate(nextIn.getUTCDate() + offset);
            const nextOut = new Date(nextIn);
            nextOut.setUTCDate(nextOut.getUTCDate() + nights);
            const checkInDate = dateKey(nextIn);
            const checkOutDate = dateKey(nextOut);
            const option = await getRoomAvailability({ ...request, checkInDate, checkOutDate });
            if (option.available) alternatives.push({ roomTypeId: selectedRoomType._id, roomType: selectedRoomType.name, checkInDate, checkOutDate, date: checkInDate, label: `${checkInDate} to ${checkOutDate} · ${selectedRoomType.name}` });
          }
        }
      }
      data.alternatives = alternatives;
    }
    res.json({ success: true, ...data });
  } catch (error) {
    console.error("checkRoomAvailability error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message, ...(error.status === 404 ? { available: false } : {}) });
  }
};
