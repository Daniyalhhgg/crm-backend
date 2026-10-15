const express = require("express");
const auth = require("../middleware/auth");
const controller = require("../controllers/dashboardNotificationController");

const router = express.Router();

router.get("/", auth, controller.getNotifications);
router.patch("/read-all", auth, controller.markAllNotificationsRead);
router.post("/handoff", auth, controller.createHandoffNotification);
router.patch("/:id/read", auth, controller.markNotificationRead);

module.exports = router;
