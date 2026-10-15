const express = require("express");
const router  = express.Router();
const auth = require("../middleware/auth");
const {
  createReminder,
  createReminderFromWhatsApp,
  cancelRemindersAfterCustomerReply,
  getReminders,
  getReminderSettings,
  updateReminderSettings,
  updateStatus,
  completeReminder,
  rescheduleReminder,
  deleteReminder,
} = require("../controllers/reminderController");

router.post("/from-whatsapp",       createReminderFromWhatsApp);
router.post("/customer-replied",    cancelRemindersAfterCustomerReply);
router.post("/create",              auth, createReminder);
router.get("/settings",             auth, getReminderSettings);
router.put("/settings",             auth, updateReminderSettings);
router.get("/",                     auth, getReminders);
router.patch("/update-status",      auth, updateStatus);
router.patch("/:id/complete",       auth, completeReminder);
router.patch("/:id/reschedule",     auth, rescheduleReminder);
router.delete("/:id",               auth, deleteReminder);

// ✅ Confirm load
console.log("✅ Registered: GET/POST /api/reminders");

module.exports = router;