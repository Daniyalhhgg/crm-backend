// // // controllers/humanModeController.js
// // const axios = require("axios");
// // const Chat = require("../models/Chat");

// // const store = {};   // temporary in-memory store

// // // n8n ke liye - NO auth
// // exports.checkHumanMode = (req, res) => {
// //   const phone = req.params.phone.replace(/[^0-9]/g, ""); // clean phone
// //   const humanMode = store[phone]?.on || false;

// //   console.log(`[Check Human Mode] ${phone} → ${humanMode}`);

// //   res.json({
// //     success: true,
// //     humanMode: humanMode,
// //     phone: phone
// //   });
// // };

// // // dashboard se toggle
// // exports.toggleHumanMode = (req, res) => {
// //   const phone = req.params.phone.replace(/[^0-9]/g, "");
// //   const { humanMode } = req.body;

// //   store[phone] = { on: !!humanMode, updatedAt: new Date() };

// //   console.log(`[Toggle Human Mode] ${phone} → ${humanMode ? "ON" : "OFF"}`);

// //   const io = req.app.get("io");
// //   if (io) io.to("chat-admins").emit("human-mode-changed", { phone, humanMode: !!humanMode });

// //   res.json({ success: true, phone, humanMode: !!humanMode });
// // };

// // // agent reply
// // exports.sendAgentReply = async (req, res) => {
// //   try {
// //     const { toPhone, message } = req.body;
// //     if (!toPhone || !message) {
// //       return res.status(400).json({ success: false, message: "toPhone and message required" });
// //     }

// //     const phone = toPhone.replace(/[^0-9]/g, "");

// //     // WhatsApp Cloud API call
// //     await axios.post(
// //       `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
// //       {
// //         messaging_product: "whatsapp",
// //         to: phone,
// //         type: "text",
// //         text: { body: message }
// //       },
// //       {
// //         headers: {
// //           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
// //           "Content-Type": "application/json"
// //         }
// //       }
// //     );

// //     // Save in DB as admin message
// //     const savedChat = await Chat.create({
// //       restaurantId: req.admin?.restaurantId || "restaurant-1",
// //       customerPhone: phone,
// //       botReply: message,
// //       sender: "admin",
// //       direction: "admin_to_customer",
// //       source: "human_agent",
// //     });

// //     // Realtime update
// //     const io = req.app.get("io");
// //     if (io) {
// //       io.to("chat-admins").emit("whatsapp-new-message", {
// //         phone,
// //         message: message,
// //         isBot: false,
// //         sender: "admin",
// //         timestamp: new Date()
// //       });
// //     }

// //     res.json({ success: true, message: "Reply sent successfully" });
// //   } catch (error) {
// //     console.error("Agent Reply Error:", error.message);
// //     res.status(500).json({ success: false, message: error.message });
// //   }
// // };
















//voice image 
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const Chat = require("../models/Chat");

const store = {};

// ============================================================
// MULTER SETUP
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads/media");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = file.mimetype.includes("audio") ? ".ogg" : path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
});

exports.uploadMiddleware = upload.single("file");

// ============================================================
// CHECK HUMAN MODE
// ============================================================
exports.checkHumanMode = (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, "");
  const humanMode = store[phone]?.on || false;
  console.log(`[Check Human Mode] ${phone} → ${humanMode}`);
  res.json({ success: true, humanMode, phone });
};

// ============================================================
// TOGGLE HUMAN MODE
// ============================================================
exports.toggleHumanMode = (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, "");
  const { humanMode } = req.body;
  store[phone] = { on: !!humanMode, updatedAt: new Date() };
  console.log(`[Toggle Human Mode] ${phone} → ${humanMode ? "ON" : "OFF"}`);
  
  const io = req.app.get("io");
  if (io) {
    io.to("chat-admins").emit("human-mode-changed", { phone, humanMode: !!humanMode });
  }
  res.json({ success: true, phone, humanMode: !!humanMode });
};

// ============================================================
// AGENT TEXT REPLY
// ============================================================
exports.sendAgentReply = async (req, res) => {
  try {
    const { toPhone, message } = req.body;
    if (!toPhone || !message) {
      return res.status(400).json({ success: false, message: "toPhone and message required" });
    }

    const phone = toPhone.replace(/[^0-9]/g, "");

    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    await Chat.create({
      restaurantId: req.admin?.restaurantId || "restaurant-1",
      customerPhone: phone,
      botReply: message,
      sender: "admin",
      direction: "admin_to_customer",
      source: "human_agent",
    });

    const io = req.app.get("io");
    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone,
        botReply: message,
        isBot: false,
        sender: "admin",
        timestamp: new Date(),
      });
    }

    res.json({ success: true, message: "Reply sent successfully" });
  } catch (error) {
    console.error("Agent Reply Error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// CONVERT AUDIO TO OGG OPUS
// ============================================================
const convertToOggOpus = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    ffmpeg(inputPath)
      .audioCodec("libopus")
      .audioChannels(1)
      .audioFrequency(16000)
      .format("ogg")
      .on("end", () => resolve())
      .on("error", reject)
      .save(outputPath);
  });
};

// ============================================================
// SEND MEDIA MESSAGE (Fixed)
// ============================================================
exports.sendMediaMessage = async (req, res) => {
  let convertedPath = null;

  try {
    const { toPhone, type, caption } = req.body;

    if (!toPhone || !type || !req.file) {
      return res.status(400).json({ success: false, message: "toPhone, type, and file are required" });
    }

    const phone = toPhone.replace(/[^0-9]/g, "");
    const waType = { image: "image", video: "video", audio: "audio", document: "document" }[type] || "document";

    // ── Step 1: Prepare file buffer ──────────────────────────
    let fileBuffer;
    let uploadFilename;
    let uploadContentType;

    if (type === "audio") {
      convertedPath = req.file.path.replace(/\.[^.]+$/, "_wa.ogg");

      try {
        await convertToOggOpus(req.file.path, convertedPath);
        fileBuffer = fs.readFileSync(convertedPath);
        console.log("[Audio] Converted to ogg/opus successfully");
      } catch (ffErr) {
        console.warn("[Audio] ffmpeg conversion failed, sending raw:", ffErr.message);
        fileBuffer = fs.readFileSync(req.file.path);
      }

      uploadFilename = `voice-${Date.now()}.ogg`;
      uploadContentType = "audio/ogg; codecs=opus";
    } else {
      fileBuffer = fs.readFileSync(req.file.path);
      uploadFilename = req.file.originalname;
      uploadContentType = req.file.mimetype;
    }

    // ── Step 2: Upload media to WhatsApp ─────────────────────
    const uploadForm = new FormData();
    uploadForm.append("file", fileBuffer, {
      filename: uploadFilename,
      contentType: uploadContentType,
    });
    uploadForm.append("messaging_product", "whatsapp");

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
      uploadForm,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          ...uploadForm.getHeaders(),
        },
      }
    );

    const mediaId = uploadRes.data.id;
    console.log(`[Media Upload] mediaId: ${mediaId}, type: ${type}`);

    // ── Step 3: Build message payload (FIXED) ────────────────
    const mediaPayload = { id: mediaId };

    if (type === "audio") {
      mediaPayload.voice = true;        // ← Correct key for Cloud API
    }

    if (caption && (waType === "image" || waType === "video" || waType === "document")) {
      mediaPayload.caption = caption;
    }

    if (waType === "document") {
      mediaPayload.filename = req.file.originalname;
    }

    // ── Step 4: Send WhatsApp message ────────────────────────
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: waType,
        [waType]: mediaPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    // ── Step 5: Public URL for dashboard ─────────────────────
    const fileUrl = `${process.env.SERVER_BASE_URL}/uploads/media/${req.file.filename}`;

    // ── Step 6: Save to Database ─────────────────────────────
    await Chat.create({
      restaurantId: req.admin?.restaurantId || "restaurant-1",
      customerPhone: phone,
      botReply: caption || "",
      mediaUrl: fileUrl,
      mediaType: type,
      sender: "admin",
      direction: "admin_to_customer",
      source: "human_agent",
    });

    // ── Step 7: Socket emit ───────────────────────────────────
    const io = req.app.get("io");
    if (io) {
      io.to("chat-admins").emit("whatsapp-new-message", {
        phone,
        botReply: caption || "",
        mediaUrl: fileUrl,
        mediaType: type,
        isBot: false,
        sender: "admin",
        timestamp: new Date(),
      });
    }

    // ── Cleanup ───────────────────────────────────────────────
    fs.unlink(req.file.path, () => {});
    if (convertedPath) fs.unlink(convertedPath, () => {});

    res.json({ success: true, message: "Media sent successfully", mediaUrl: fileUrl });

  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    if (convertedPath) fs.unlink(convertedPath, () => {});

    console.error("Send Media Error:", error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.error?.message || error.message 
    });
  }
};







// //voice working
// const axios = require("axios");
// const multer = require("multer");
// const path = require("path");
// const fs = require("fs");
// const FormData = require("form-data");
// const Chat = require("../models/Chat");

// const store = {};

// // ============================================================
// // MULTER SETUP
// // ============================================================
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const dir = path.join(__dirname, "../uploads/media");
//     if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
//     cb(null, dir);
//   },
//   filename: (req, file, cb) => {
//     const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
//     const ext = file.mimetype.includes("audio") ? ".ogg" : path.extname(file.originalname);
//     cb(null, unique + ext);
//   },
// });

// const upload = multer({
//   storage,
//   limits: { fileSize: 16 * 1024 * 1024 },
// });

// exports.uploadMiddleware = upload.single("file");

// // ============================================================
// // CHECK HUMAN MODE
// // ============================================================
// exports.checkHumanMode = (req, res) => {
//   const phone = req.params.phone.replace(/[^0-9]/g, "");
//   const humanMode = store[phone]?.on || false;
//   console.log(`[Check Human Mode] ${phone} → ${humanMode}`);
//   res.json({ success: true, humanMode, phone });
// };

// // ============================================================
// // TOGGLE HUMAN MODE
// // ============================================================
// exports.toggleHumanMode = (req, res) => {
//   const phone = req.params.phone.replace(/[^0-9]/g, "");
//   const { humanMode } = req.body;
//   store[phone] = { on: !!humanMode, updatedAt: new Date() };
//   console.log(`[Toggle Human Mode] ${phone} → ${humanMode ? "ON" : "OFF"}`);
  
//   const io = req.app.get("io");
//   if (io) {
//     io.to("chat-admins").emit("human-mode-changed", { phone, humanMode: !!humanMode });
//   }
//   res.json({ success: true, phone, humanMode: !!humanMode });
// };

// // ============================================================
// // AGENT TEXT REPLY
// // ============================================================
// exports.sendAgentReply = async (req, res) => {
//   try {
//     const { toPhone, message } = req.body;
//     if (!toPhone || !message) {
//       return res.status(400).json({ success: false, message: "toPhone and message required" });
//     }

//     const phone = toPhone.replace(/[^0-9]/g, "");

//     await axios.post(
//       `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//       {
//         messaging_product: "whatsapp",
//         to: phone,
//         type: "text",
//         text: { body: message },
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     await Chat.create({
//       restaurantId: req.admin?.restaurantId || "restaurant-1",
//       customerPhone: phone,
//       botReply: message,
//       sender: "admin",
//       direction: "admin_to_customer",
//       source: "human_agent",
//     });

//     const io = req.app.get("io");
//     if (io) {
//       io.to("chat-admins").emit("whatsapp-new-message", {
//         phone,
//         botReply: message,
//         isBot: false,
//         sender: "admin",
//         timestamp: new Date(),
//       });
//     }

//     res.json({ success: true, message: "Reply sent successfully" });
//   } catch (error) {
//     console.error("Agent Reply Error:", error.response?.data || error.message);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // ============================================================
// // CONVERT AUDIO TO OGG OPUS (Improved)
// // ============================================================
// const convertToOggOpus = (inputPath, outputPath) => {
//   return new Promise((resolve, reject) => {
//     const ffmpeg = require("fluent-ffmpeg");
//     ffmpeg(inputPath)
//       .audioCodec("libopus")
//       .audioChannels(1)
//       .audioFrequency(16000)
//       .audioBitrate("64k")           // Added for better quality
//       .format("ogg")
//       .on("end", () => {
//         console.log("[FFmpeg] Conversion completed successfully");
//         resolve();
//       })
//       .on("error", (err) => {
//         console.error("[FFmpeg] Error:", err.message);
//         reject(err);
//       })
//       .save(outputPath);
//   });
// };

// // ============================================================
// // SEND MEDIA MESSAGE (Final Updated)
// // ============================================================
// exports.sendMediaMessage = async (req, res) => {
//   let convertedPath = null;

//   try {
//     const { toPhone, type, caption } = req.body;

//     if (!toPhone || !type || !req.file) {
//       return res.status(400).json({ success: false, message: "toPhone, type, and file are required" });
//     }

//     const phone = toPhone.replace(/[^0-9]/g, "");
//     const waType = { image: "image", video: "video", audio: "audio", document: "document" }[type] || "document";

//     // ── Step 1: Prepare file buffer ──────────────────────────
//     let fileBuffer;
//     let uploadFilename;
//     let uploadContentType;

//     if (type === "audio") {
//       convertedPath = req.file.path.replace(/\.[^.]+$/, "_wa.ogg");

//       try {
//         await convertToOggOpus(req.file.path, convertedPath);
//         fileBuffer = fs.readFileSync(convertedPath);
//         console.log("[Audio] ✅ Converted to ogg/opus successfully");
//       } catch (ffErr) {
//         console.warn("[Audio] ffmpeg conversion failed, sending raw:", ffErr.message);
//         fileBuffer = fs.readFileSync(req.file.path);
//       }

//       uploadFilename = `voice-${Date.now()}.ogg`;
//       uploadContentType = "audio/ogg; codecs=opus";
//     } else {
//       fileBuffer = fs.readFileSync(req.file.path);
//       uploadFilename = req.file.originalname;
//       uploadContentType = req.file.mimetype;
//     }

//     // ── Step 2: Upload media to WhatsApp ─────────────────────
//     const uploadForm = new FormData();
//     uploadForm.append("file", fileBuffer, {
//       filename: uploadFilename,
//       contentType: uploadContentType,
//     });
//     uploadForm.append("messaging_product", "whatsapp");

//     const uploadRes = await axios.post(
//       `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
//       uploadForm,
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
//           ...uploadForm.getHeaders(),
//         },
//       }
//     );

//     const mediaId = uploadRes.data.id;
//     console.log(`[Media Upload] mediaId: ${mediaId}, type: ${type}`);

//     // ── Step 3: Build message payload ────────────────────────
//     const mediaPayload = { id: mediaId };

//     if (type === "audio") {
//       mediaPayload.voice = true;        // Must be "voice", not "ptt"
//     }

//     if (caption && (waType === "image" || waType === "video" || waType === "document")) {
//       mediaPayload.caption = caption;
//     }

//     if (waType === "document") {
//       mediaPayload.filename = req.file.originalname;
//     }

//     // ── Step 4: Send WhatsApp message ────────────────────────
//     await axios.post(
//       `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//       {
//         messaging_product: "whatsapp",
//         to: phone,
//         type: waType,
//         [waType]: mediaPayload,
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     // ── Step 5: Public URL for dashboard ─────────────────────
//     const fileUrl = `${process.env.SERVER_BASE_URL}/uploads/media/${req.file.filename}`;

//     // ── Step 6: Save to Database ─────────────────────────────
//     await Chat.create({
//       restaurantId: req.admin?.restaurantId || "restaurant-1",
//       customerPhone: phone,
//       botReply: caption || "",
//       mediaUrl: fileUrl,
//       mediaType: type,
//       sender: "admin",
//       direction: "admin_to_customer",
//       source: "human_agent",
//     });

//     // Socket emit
//     const io = req.app.get("io");
//     if (io) {
//       io.to("chat-admins").emit("whatsapp-new-message", {
//         phone,
//         botReply: caption || "",
//         mediaUrl: fileUrl,
//         mediaType: type,
//         isBot: false,
//         sender: "admin",
//         timestamp: new Date(),
//       });
//     }

//     // Cleanup
//     fs.unlink(req.file.path, () => {});
//     if (convertedPath) fs.unlink(convertedPath, () => {});

//     res.json({ success: true, message: "Media sent successfully", mediaUrl: fileUrl });

//   } catch (error) {
//     if (req.file?.path) fs.unlink(req.file.path, () => {});
//     if (convertedPath) fs.unlink(convertedPath, () => {});

//     console.error("Send Media Error:", error.response?.data || error.message);
//     res.status(500).json({ 
//       success: false, 
//       message: error.response?.data?.error?.message || error.message 
//     });
//   }
// };