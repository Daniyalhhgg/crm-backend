const express = require("express");
const router = express.Router();

const {
  getAllBookings,
  createBooking,
  getBookingById,
  createBookingFromWhatsApp,
  updateBookingStatus,
  updateBooking,
  confirmBooking,
  capturePaymentScreenshot,
  verifyPayment,
  checkInBooking,
} = require("../controllers/bookingController");

const auth = require("../middleware/auth");

// ======================
// PUBLIC ROUTES (no auth) — n8n hits this
// ======================
router.post("/from-whatsapp", createBookingFromWhatsApp);
router.post("/payment-screenshot", capturePaymentScreenshot);
router.post("/:id/payment-screenshot", capturePaymentScreenshot);

// ======================
// PROTECTED ROUTES (auth required)
// ======================
router.patch("/:id/status", auth, updateBookingStatus); // Quick status update (confirm/cancel buttons)
router.patch("/:id/confirm", auth, confirmBooking);
router.patch("/:id/verify-payment", auth, verifyPayment);
router.patch("/:id/check-in", auth, checkInBooking);
router.put("/:id", auth, updateBooking);                // Full booking edit (CRM modal)
router.get("/:id", auth, getBookingById);
router.post("/", auth, createBooking);
router.get("/", auth, getAllBookings);

module.exports = router;