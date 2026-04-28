const Admin = require('../models/Admin');
const jwt = require('jsonwebtoken');

// ======================
// GENERATE TOKEN (FIXED)
// ======================
const generateToken = (admin) => {
  return jwt.sign(
    {
      id: admin._id,
      email: admin.email,
      restaurantId: admin.restaurantId  // 🔥 Add restaurantId
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || '7d',
    }
  );
};

// ======================
// Register Admin
// ======================
exports.register = async (req, res) => {
  try {
    const { name, email, password, restaurantId } = req.body;

    console.log(`📝 Register attempt: ${email}`);

    // Check if admin already exists
    let admin = await Admin.findOne({ email });
    if (admin) {
      return res.status(400).json({
        success: false,
        message: 'Admin already exists'
      });
    }

    admin = new Admin({
      name,
      email,
      password,
      restaurantId: restaurantId || 'restaurant-1',
    });

    await admin.save();

    const token = generateToken(admin);

    console.log(`✅ Admin registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        restaurantId: admin.restaurantId,
      },
    });
  } catch (error) {
    console.error(`❌ Register error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// LOGIN (FIXED)
// ======================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Login attempt: ${email}`);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      console.warn(`⚠️ Admin not found: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const isPasswordCorrect = await admin.comparePassword(password);

    if (!isPasswordCorrect) {
      console.warn(`⚠️ Invalid password: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!admin.isActive) {
      console.warn(`⚠️ Account disabled: ${email}`);
      return res.status(403).json({
        success: false,
        message: 'Account is disabled'
      });
    }

    // 🔥 Generate token with restaurantId
    const token = generateToken(admin);

    console.log(`✅ Login successful: ${email}`);
    console.log(`   Restaurant: ${admin.restaurantId}`);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        restaurantId: admin.restaurantId,
      },
    });
  } catch (error) {
    console.error(`❌ Login error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// GET CURRENT ADMIN
// ======================
exports.getCurrentAdmin = async (req, res) => {
  try {
    console.log(`👤 Get current admin: ${req.adminId}`);

    const admin = await Admin.findById(req.adminId).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    console.log(`✅ Admin found: ${admin.email}`);

    res.status(200).json({
      success: true,
      admin,
    });
  } catch (error) {
    console.error(`❌ Get admin error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// LOGOUT
// ======================
exports.logout = async (req, res) => {
  try {
    console.log(`👋 Logout: ${req.admin.email}`);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error(`❌ Logout error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};