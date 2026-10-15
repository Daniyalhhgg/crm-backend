// routes/webhookRoutes.js
const express = require("express");
const router = express.Router();

const { handleWhatsAppWebhook } = require("../controllers/webhookController");

router.post("/live-event", handleWhatsAppWebhook);

module.exports = router;