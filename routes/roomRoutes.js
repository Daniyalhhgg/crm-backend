const express = require("express");
const auth = require("../middleware/auth");
const controller = require("../controllers/roomController");

const router = express.Router();

router.get("/types/public", controller.getRoomTypes);
router.get("/availability/check", controller.checkAvailability);
router.get("/types", auth, controller.getRoomTypes);
router.post("/types", auth, controller.createRoomType);
router.put("/types/:id", auth, controller.updateRoomType);
router.delete("/types/:id", auth, controller.deleteRoomType);
router.get("/availability/month", auth, controller.getMonthAvailability);
router.put("/availability", auth, controller.updateRoomInventory);

module.exports = router;
