const express = require("express");
const auth = require("../middleware/auth");
const controller = require("../controllers/inquiryLearningController");

const router = express.Router();

router.get("/public", controller.getPublicLearningItems);
router.get("/", auth, controller.getLearningItems);
router.post("/", auth, controller.createLearningItem);
router.put("/:id", auth, controller.updateLearningItem);
router.delete("/:id", auth, controller.deleteLearningItem);

module.exports = router;
