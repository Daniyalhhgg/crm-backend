const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

// .env فائل کو درست طریقے سے لوڈ کریں
dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('MONGODB_URI Status:', process.env.MONGODB_URI ? '✅ Loaded' : '❌ Not Found');

// Admin Model Import
const Admin = require('./models/Admin');

// MongoDB Connect
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in .env file!');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => {
    console.error('❌ MongoDB Connection Failed:', err.message);
    process.exit(1);
  });

const createAdmin = async () => {
  try {
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: "admin@yourcrm.com" });

    if (existingAdmin) {
      console.log('⚠️ Admin already exists with this email!');
      mongoose.disconnect();
      return;
    }

    // Create new Admin
    const newAdmin = new Admin({
      name: "Super Admin",
      email: "admin@yourcrm.com",
      password: "admin123",           // Raw password (model خود hash کر دے گا)
      role: "admin",
      restaurantId: "restaurant-1 ", // اگر آپ کے پاس کوئی اور ID ہے تو بدل دیں
      isActive: true
    });

    await newAdmin.save();

    console.log('\n🎉 SUCCESS! Admin User Created');
    console.log('══════════════════════════════════════');
    console.log('📧 Email    : admin@yourcrm.com');
    console.log('🔑 Password : admin123');
    console.log('══════════════════════════════════════');
    console.log('اب آپ Login page پر یہ ای میل اور پاس ورڈ استعمال کر کے لاگ ان کر سکتے ہیں۔');

  } catch (error) {
    console.error('\n❌ Error creating admin:', error.message);
  } finally {
    mongoose.disconnect();
  }
};

createAdmin();