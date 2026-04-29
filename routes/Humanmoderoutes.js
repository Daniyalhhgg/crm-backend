// routes/Humanmoderoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

// ✅ Correct require (file name ke hisaab se)
const {
  checkHumanMode,
  toggleHumanMode,
  sendAgentReply
} = require("../controllers/Humanmodecontroller");

console.log("✅ [humanModeRoutes] File loaded");

router.get("/check/:phone", checkHumanMode);
router.put("/toggle/:phone", auth, toggleHumanMode);
router.post("/reply", auth, sendAgentReply);

console.log("✅ [humanModeRoutes] 3 routes registered under /api/human-mode");

module.exports = router;
