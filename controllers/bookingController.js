const Booking = require('../models/Booking');

// ======================
// Get all bookings
// ======================
exports.getAllBookings = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`\n📅 getAllBookings:`);
    console.log(`   Restaurant: ${restaurantId}`);

    const bookings = await Booking.find({
      restaurantId: restaurantId
    }).sort({ createdAt: -1 });

    console.log(`✅ Found ${bookings.length} bookings`);

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error("❌ Get All Bookings Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Create booking (Admin)
// ======================
exports.createBooking = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    console.log(`\n📝 createBooking:`);
    console.log(`   Restaurant: ${restaurantId}`);

    const booking = await Booking.create({
      ...req.body,
      restaurantId: restaurantId
    });

    const io = req.app.get("io");

    if (io) {
      io.to("chat-admins").emit("new_booking", {
        type: "NEW_BOOKING",
        data: booking
      });
    }

    console.log(`✅ Booking created: ${booking._id}`);

    res.status(201).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("❌ Create Booking Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Get booking by ID
// ======================
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`\n📅 getBookingById: ${id}`);

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    console.log(`✅ Booking found: ${booking._id}`);

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("❌ Get Booking Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Create booking from WhatsApp (n8n)
// ======================
exports.createBookingFromWhatsApp = async (req, res) => {
  try {
    console.log("📅 BOOKING REQUEST FROM n8n:", req.body);

    const { bookingData, fromNumber, restaurantId = "restaurant-1" } = req.body;

    if (!bookingData || !fromNumber) {
      return res.status(400).json({
        success: false,
        message: "bookingData and fromNumber are required"
      });
    }

    let parsed = bookingData;
    if (typeof bookingData === "string") {
      try {
        parsed = JSON.parse(bookingData);
      } catch (e) {
        console.error("❌ Booking JSON parse failed:", e);
      }
    }

    // ✅ FIXED: Reading flat fields sent by n8n
    const booking = await Booking.create({
      customerId: fromNumber,
      customerName: parsed.customerName || "WhatsApp Customer",
      customerPhone: parsed.customerPhone || fromNumber,
      customerEmail: parsed.customerEmail || "",
      package: parsed.package || "",
      numberOfPersons: parsed.numberOfPersons || 1,
      bookingDate: parsed.bookingDate,
      bookingTime: parsed.bookingTime,
      specialRequests: parsed.specialRequests || "",
      restaurantId: parsed.restaurantId || restaurantId,
      status: "pending",
      bookingSource: "whatsapp-bot"
    });

    console.log("✅ Booking created:", booking._id);

    const io = req.app.get("io");

    if (io) {
      io.to("chat-admins").emit("new_booking", {
        type: "NEW_BOOKING",
        data: booking
      });
    }

    res.status(201).json({
      success: true,
      message: "Booking created from WhatsApp AI",
      data: booking
    });

  } catch (error) {
    console.error("❌ Create Booking from WhatsApp Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ======================
// Update booking status
// ======================
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log(`\n📅 updateBookingStatus:`);
    console.log(`   ID: ${id}`);
    console.log(`   Status: ${status}`);

    const booking = await Booking.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to("chat-admins").emit("booking_updated", {
        bookingId: id,
        status: status,
        booking: booking
      });
    }

    console.log(`✅ Booking updated: ${booking._id}`);

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("❌ Update Booking Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};