const express = require("express");
const router = express.Router();

const {
  getAllBookings,
  createBooking,
  getBookingById,
  createBookingFromWhatsApp,
  updateBookingStatus
} = require("../controllers/bookingController");

const auth = require("../middleware/auth");

// ======================
// PUBLIC ROUTES (no auth) — n8n hits this
// ======================
router.post("/from-whatsapp", createBookingFromWhatsApp);

// ======================
// PROTECTED ROUTES (auth required)
// ======================
router.put("/:id", auth, updateBookingStatus);
router.get("/:id", auth, getBookingById);
router.post("/", auth, createBooking);
router.get("/", auth, getAllBookings);

module.exports = router;