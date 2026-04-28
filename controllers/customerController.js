const Chat = require('../models/Chat');
const Booking = require('../models/Booking');

// ======================
// Get all customers
// ======================
exports.getAllCustomers = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`\n👥 getAllCustomers:`);
    console.log(`   Restaurant: ${restaurantId}`);

    const customers = await Chat.aggregate([
      {
        $match: {
          restaurantId: restaurantId
        }
      },
      {
        $group: {
          _id: "$customerPhone",
          customerPhone: { $first: "$customerPhone" },
          customerName: { $first: "$customerName" },
          lastMessage: { $last: "$customerMessage" },
          lastBotReply: { $last: "$botReply" },
          lastMessageTime: { $max: "$createdAt" },
          messageCount: { $sum: 1 }
        }
      },
      { $sort: { lastMessageTime: -1 } }
    ]);

    console.log(`✅ Found ${customers.length} customers`);

    res.json({
      success: true,
      data: customers
    });

  } catch (error) {
    console.error("❌ Get All Customers Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Get customer details (chats + bookings)
// ======================
exports.getCustomerDetails = async (req, res) => {
  try {
    const { phone } = req.params;
    const restaurantId = req.admin.restaurantId;

    console.log(`\n👥 getCustomerDetails:`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Restaurant: ${restaurantId}`);

    const chats = await Chat.find({
      restaurantId: restaurantId,
      customerPhone: phone
    }).sort({ createdAt: -1 });

    const bookings = await Booking.find({
      restaurantId: restaurantId,
      customerPhone: phone
    }).sort({ createdAt: -1 });

    const customer = {
      customerPhone: phone,
      customerName: chats[0]?.customerName || "WhatsApp Customer",
      customerEmail: chats[0]?.customerEmail || ""
    };

    console.log(`✅ Found ${chats.length} chats and ${bookings.length} bookings`);

    res.json({
      success: true,
      customer,
      chats,
      bookings
    });

  } catch (error) {
    console.error("❌ Get Customer Details Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Get customer by phone (Optional - fallback)
// ======================
exports.getCustomerByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const restaurantId = req.admin.restaurantId;

    console.log(`\n👥 getCustomerByPhone:`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Restaurant: ${restaurantId}`);

    const chats = await Chat.find({
      restaurantId: restaurantId,
      customerPhone: phone
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${chats.length} chats`);

    res.json({
      success: true,
      data: chats
    });

  } catch (error) {
    console.error("❌ Get Customer By Phone Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};