const Chat = require('../models/Chat');
const Booking = require('../models/Booking');

/**
 * =========================
 * DASHBOARD OVERVIEW
 * =========================
 */
exports.getDashboardOverview = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    const totalChats = await Chat.countDocuments({ restaurantId });

    const totalCustomersArr = await Chat.distinct('customerId', {
      restaurantId,
    });
    const totalCustomers = totalCustomersArr.length;

    const totalBookings = await Booking.countDocuments({ restaurantId });

    const confirmedBookings = await Booking.countDocuments({
      restaurantId,
      status: 'confirmed',
    });

    const pendingBookings = totalBookings - confirmedBookings;

    const revenueData = await Booking.find({
      restaurantId,
      status: 'confirmed',
    }).select('price');

    const totalRevenue = revenueData.reduce(
      (sum, b) => sum + (b.price || 0),
      0
    );

    // today stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayChats = await Chat.countDocuments({
      restaurantId,
      timestamp: { $gte: todayStart },
    });

    const todayBookings = await Booking.countDocuments({
      restaurantId,
      createdAt: { $gte: todayStart },
    });

    const conversionRate =
      totalBookings > 0
        ? ((confirmedBookings / totalBookings) * 100).toFixed(2)
        : '0.00';

    return res.status(200).json({
      success: true,
      overview: {
        totalChats,
        totalCustomers,
        totalBookings,
        confirmedBookings,
        pendingBookings,
        totalRevenue,
        conversionRate: `${conversionRate}%`,
        todayChats,
        todayBookings,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * =========================
 * ACTIVITY TIMELINE
 * =========================
 */
exports.getActivityTimeline = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const days = parseInt(req.query.days || 7);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const chatTimeline = await Chat.aggregate([
      {
        $match: {
          restaurantId,
          timestamp: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$timestamp',
            },
          },
          chats: { $sum: 1 },
          customers: { $addToSet: '$customerId' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const bookingTimeline = await Booking.aggregate([
      {
        $match: {
          restaurantId,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          bookings: { $sum: 1 },
          confirmed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const merged = chatTimeline.map((c) => {
      const b = bookingTimeline.find((x) => x._id === c._id);

      return {
        date: c._id,
        chats: c.chats,
        uniqueCustomers: c.customers.length,
        bookings: b?.bookings || 0,
        confirmedBookings: b?.confirmed || 0,
      };
    });

    return res.status(200).json({
      success: true,
      timeline: merged,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * =========================
 * POPULAR PACKAGES
 * =========================
 */
exports.getPopularPackages = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    const packages = await Booking.aggregate([
      { $match: { restaurantId } },
      {
        $group: {
          _id: '$package',
          count: { $sum: 1 },
          revenue: { $sum: '$price' },
          avgPrice: { $avg: '$price' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return res.status(200).json({
      success: true,
      packages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * =========================
 * BOOKING TRENDS
 * =========================
 */
exports.getBookingTrends = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    const byStatus = await Booking.aggregate([
      { $match: { restaurantId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const bySource = await Booking.aggregate([
      { $match: { restaurantId } },
      {
        $group: {
          _id: '$bookingSource',
          count: { $sum: 1 },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      trends: {
        byStatus,
        bySource,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * =========================
 * RECENT ACTIVITY FEED
 * =========================
 */
exports.getRecentActivity = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;
    const limit = parseInt(req.query.limit || 20);

    const recentChats = await Chat.find({ restaurantId })
      .sort('-timestamp')
      .limit(limit)
      .lean();

    const recentBookings = await Booking.find({ restaurantId })
      .sort('-createdAt')
      .limit(limit)
      .lean();

    const activity = [];

    recentChats.forEach((chat) => {
      activity.push({
        type: 'chat',
        timestamp: chat.timestamp,
        description: `Message from ${chat.customerName || 'User'}: "${(
          chat.customerMessage || ''
        ).substring(0, 50)}..."`,
        customer: chat.customerName,
        phone: chat.customerPhone,
      });
    });

    recentBookings.forEach((booking) => {
      activity.push({
        type: 'booking',
        timestamp: booking.createdAt,
        description: `New booking: ${booking.package} for ${booking.numberOfPersons} persons`,
        customer: booking.customerName,
        phone: booking.customerPhone,
        status: booking.status,
      });
    });

    activity.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    return res.status(200).json({
      success: true,
      activity: activity.slice(0, limit),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};