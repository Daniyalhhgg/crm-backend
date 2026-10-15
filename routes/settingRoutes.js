const express = require("express");
const auth = require("../middleware/auth");
const { getLoyaltySettings, updateLoyaltySettings } = require("../controllers/loyaltyController");
const {
  getServiceClosures,
  getPublicServiceClosures,
  upsertServiceClosure,
  deleteServiceClosure,
} = require("../controllers/serviceClosureController");
const {
  getAgentPrompt,
  updateAgentPrompt,
  resetAgentPrompt,
  getPublicAgentPrompt,
} = require("../controllers/agentPromptController");

const router = express.Router();
router.get("/agent-prompt/public", getPublicAgentPrompt);
router.get("/service-closures/status", getPublicServiceClosures);
router.get("/agent-prompt", auth, getAgentPrompt);
router.put("/agent-prompt", auth, updateAgentPrompt);
router.post("/agent-prompt/reset", auth, resetAgentPrompt);
router.get("/service-closures", auth, getServiceClosures);
router.post("/service-closures", auth, upsertServiceClosure);
router.delete("/service-closures/:date", auth, deleteServiceClosure);
router.get("/loyalty", auth, getLoyaltySettings);
router.put("/loyalty", auth, updateLoyaltySettings);

module.exports = router;
