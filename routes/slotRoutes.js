const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth"); // your existing auth middleware

const {
  getAvailability,
  getDateAvailability,
  getHiTeaSchedule,
  getSlotsByMonth,
  upsertSlot,
  bulkUpdateSlots,
  getPublicSlots,
} = require("../controllers/slotController");

// =============================================
// PUBLIC (no auth) — WhatsApp bot / n8n uses this
// =============================================
router.get("/availability", getAvailability);
router.get("/availability/admin", auth, getAvailability);
router.get("/availability/date", getDateAvailability);
router.get("/availability/date/admin", auth, getDateAvailability);
router.get("/hitea-schedule", getHiTeaSchedule);
router.get("/hitea-schedule/admin", auth, getHiTeaSchedule);
router.get("/public", getPublicSlots);

// =============================================
// PROTECTED — CRM manages category-specific calendars
// =============================================
router.get("/", auth, getSlotsByMonth);          // GET /api/slots?month=2025-06
router.put("/", auth, upsertSlot);               // PUT /api/slots  (single slot update)
router.put("/bulk", auth, bulkUpdateSlots);      // PUT /api/slots/bulk (day update)

module.exports = router;