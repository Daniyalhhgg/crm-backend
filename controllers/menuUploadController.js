const cloudinary = require("cloudinary").v2;

exports.uploadMenuMedia = async (req, res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(503).json({ success: false, message: "Media upload is not configured. Paste a media URL or configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET." });
  }
  if (!req.file) return res.status(400).json({ success: false, message: "A media file is required" });
  const isPdf = req.file.mimetype === "application/pdf" && /\.pdf$/i.test(req.file.originalname || "");
  if (!isPdf && !["image", "video", "audio"].some((type) => req.file.mimetype.startsWith(`${type}/`))) {
    return res.status(400).json({ success: false, message: "Only image, video, audio, and PDF files are allowed" });
  }
  try {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const resourceType = req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("video/") ? "video" : "raw";
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: resourceType,
        folder: "hotel-crm/menus",
        ...(isPdf ? { use_filename: true, unique_filename: true, filename_override: req.file.originalname } : {}),
      }, (error, uploaded) => {
        if (error) reject(error);
        else resolve(uploaded);
      });
      stream.end(req.file.buffer);
    });
    res.json({ success: true, url: result.secure_url, resourceType, format: result.format });
  } catch (error) {
    console.error("uploadMenuMedia error:", error);
    res.status(502).json({ success: false, message: "Cloudinary upload failed", error: error.message });
  }
};
