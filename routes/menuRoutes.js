const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const controller = require("../controllers/menuController");
const { uploadMenuMedia } = require("../controllers/menuUploadController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get("/public", controller.getPublicMenus);
router.post("/upload", auth, upload.single("file"), uploadMenuMedia);
router.get("/", auth, controller.getMenus);
router.post("/:category/offers", auth, controller.addOffer);
router.put("/:category/offers/:offerId", auth, controller.updateOffer);
router.delete("/:category/offers/:offerId", auth, controller.deleteOffer);
router.patch("/:category/offers/:offerId/toggle", auth, controller.toggleOffer);
router.get("/:category", auth, controller.getMenu);
router.put("/:category", auth, controller.upsertMenu);
router.delete("/:category", auth, controller.deleteMenu);

module.exports = router;
