const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log("⚡ Already connected");
    return;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = conn.connections[0].readyState === 1;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ DB Error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;