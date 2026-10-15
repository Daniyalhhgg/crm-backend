const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const auth = async (req, res, next) => {
  try {
    let token;

    console.log(`\n🔐 Auth Middleware:`);
    console.log(`   URL: ${req.originalUrl}`);

    // Extract token from Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
      console.log(`   Token found: ✅ Yes`);
    } else {
      console.warn(`   Token found: ❌ No`);
    }

    // No token provided
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
        hint: "Include Authorization: Bearer YOUR_TOKEN"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(`   ✅ Token verified`);
    console.log(`   Admin ID: ${decoded.id}`);
    console.log(`   Email: ${decoded.email}`);
    console.log(`   Restaurant: ${decoded.restaurantId}`);

    // Get admin from database
    const admin = await Admin.findById(decoded.id).select("-password");

    if (!admin) {
      console.warn(`   ❌ Admin not found in database`);
      return res.status(401).json({
        success: false,
        message: "Admin not found",
      });
    }

    // ✅ ATTACH TO REQUEST (IMPORTANT!)
    req.admin = admin;           // 🔥 Full admin object
    req.adminId = admin._id;     // 🔥 Admin ID
    req.restaurantId = admin.restaurantId;  // 🔥 Restaurant ID
    req.decodedToken = decoded;  // 🔥 Decoded token

    console.log(`   ✅ Admin attached to request`);

    next();
  } catch (error) {
    console.error(`❌ Auth Error: ${error.message}`);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
        error: error.message
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired",
        error: error.message
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: error.message
    });
  }
};

module.exports = auth;