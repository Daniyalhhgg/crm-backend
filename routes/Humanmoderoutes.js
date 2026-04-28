// routes/humanModeRoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const { 
  checkHumanMode, 
  toggleHumanMode, 
  sendAgentReply 
} = require("../controllers/humanModeController");

console.log("✅ [humanModeRoutes] File loaded");

router.get("/check/:phone", checkHumanMode);
router.put("/toggle/:phone", auth, toggleHumanMode);
router.post("/reply", auth, sendAgentReply);

console.log("✅ [humanModeRoutes] 3 routes registered under /api/human-mode");

module.exports = router;