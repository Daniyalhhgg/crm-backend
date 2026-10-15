const express = require("express");
const auth = require("../middleware/auth");
const controller = require("../controllers/corporateController");

const router = express.Router();

router.get("/questions", controller.getQuestions);
router.post("/enquiries/flow", controller.handleEnquiryFlow);
router.get("/venues/public", controller.getVenues);
router.get("/availability/public", controller.checkAvailability);
router.post("/availability/check", controller.checkAvailability);
router.get("/availability/suggest", controller.suggestDates);

router.get("/stages", auth, controller.getStages);
router.get("/venues", auth, controller.getVenues);
router.put("/venues/:hallId", auth, controller.updateVenue);
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
router.patch("/bookings/:id/ai-replies/:replyId", auth, controller.reviewAiReply);

module.exports = router;
