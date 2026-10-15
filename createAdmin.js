const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file from the current directory
dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('MONGODB_URI Status:', process.env.MONGODB_URI ? '✅ Loaded' : '❌ Not Found');

// Import Admin model
const Admin = require('./models/Admin');

if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in .env file!');
  process.exit(1);
}

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected Successfully');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: 'admin@yourcrm.com' });

    if (existingAdmin) {
      console.log('⚠️ Admin already exists with this email!');
      return;
    }

    // Create new admin (the model hashes the password automatically)
    const newAdmin = new Admin({
      name: 'Super Admin',
      email: 'admin@yourcrm.com',
      password: 'admin123',
      role: 'admin',
      restaurantId: 'restaurant-1', // Change this if you use a different ID
      isActive: true
    });

    await newAdmin.save();

    console.log('\n🎉 SUCCESS! Admin user created');
    console.log('══════════════════════════════════════');
    console.log('📧 Email    : admin@yourcrm.com');
    console.log('🔑 Password : admin123');
    console.log('══════════════════════════════════════');
    console.log('You can now log in on the login page with this email and password.');
  } catch (error) {
    console.error('\n❌ Error creating admin:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

createAdmin();
