const express = require("express");
const controller = require("../controllers/loyaltyController");

const router = express.Router();
router.get("/:phone", controller.getLoyalty);

module.exports = router;
