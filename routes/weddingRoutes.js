const express = require("express");
const auth = require("../middleware/auth");
const controller = require("../controllers/weddingController");

const router = express.Router();

router.get("/questions", controller.getQuestions);
router.post("/enquiries/start", controller.startEnquiry);
router.post("/enquiries/answer", controller.saveEnquiryAnswer);
router.post("/enquiries/flow", controller.handleEnquiryMessage);
router.get("/enquiries/availability", controller.checkEnquiryHalls);

router.get("/halls/public", controller.getHalls);
router.get("/availability/public", controller.checkHallAvailability);
router.get("/availability/suggest", controller.suggestHallDates);
router.post("/availability/check", controller.checkHallAvailability);

router.get("/stages", auth, controller.getStages);
router.get("/payment-instructions", auth, controller.getPaymentInstructions);
router.get("/halls", auth, controller.getHalls);
router.put("/halls/:hallId", auth, controller.updateHall);
router.get("/availability/month", auth, controller.getHallMonth);
router.put("/availability", auth, controller.updateHallDate);

router.get("/bookings", auth, controller.getBookings);
router.post("/bookings", auth, controller.createBooking);
router.get("/bookings/:id", auth, controller.getBooking);
router.put("/bookings/:id", auth, controller.updateBooking);
router.patch("/bookings/:id/stage", auth, controller.updateStage);
router.post("/bookings/:id/quotation", auth, controller.createQuotation);
router.patch("/bookings/:id/verify-payment", auth, controller.verifyPayment);
router.patch("/bookings/:id/confirm", auth, controller.confirmBooking);
router.post("/bookings/:id/reminder", auth, controller.scheduleReminder);
router.patch("/bookings/:id/follow-up", auth, controller.sendFollowUpLater);
router.patch("/bookings/:id/no-booking", auth, controller.confirmNoBooking);
router.patch("/bookings/:id/ai-replies/:replyId", auth, controller.reviewAiReply);

module.exports = router;
