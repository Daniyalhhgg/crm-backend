const Chat = require('../models/Chat');
const Booking = require('../models/Booking');
const WeddingBooking = require('../models/WeddingBooking');
const RoomType = require('../models/RoomType');
const Menu = require('../models/Menu');
const Setting = require('../models/Setting');
const menuCategoryForPackage = require('../utils/menuCategory');

const getZonedDayBounds = (reference, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(reference).map(({ type, value }) => [type, value]));
  const wallStart = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const toUtc = (wallTime) => {
    let guess = wallTime;
    for (let attempt = 0; attempt < 3; attempt++) {
      const displayed = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, value]));
      const represented = Date.UTC(
        Number(displayed.year),
        Number(displayed.month) - 1,
        Number(displayed.day),
        Number(displayed.hour) === 24 ? 0 : Number(displayed.hour),
        Number(displayed.minute),
        Number(displayed.second),
      );
      const adjustment = wallTime - represented;
      guess += adjustment;
      if (!adjustment) break;
    }
    return new Date(guess);
  };
  return { start: toUtc(wallStart), end: toUtc(wallStart + 86400000) };
};
const getRevenueAmountExpression = () => ({
  $cond: [
    { $gt: [{ $ifNull: ['$totalAmount', 0] }, 0] },
    '$totalAmount',
    {
      $cond: [
        { $gt: [{ $ifNull: ['$price', 0] }, 0] },
        '$price',
        { $ifNull: ['$amount', 0] },
      ],
    },
  ],
});

/**
 * =========================
 * DASHBOARD OVERVIEW
 * =========================
 */
exports.getDashboardOverview = async (req, res) => {
  try {
    const restaurantId = req.admin.restaurantId;

    const [
      totalChats,
      totalCustomersArr,
      totalBookings,
      confirmedBookings,
      checkedInBookings,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      noShowBookings,
      revenueRows,
      bookingsByPackage,
      eventPipelines,
      activeRoomTypes,
      activeMenus,
      promptSetting,
    ] = await Promise.all([
      Chat.countDocuments({ restaurantId }),
      Chat.distinct('customerPhone', { restaurantId }),
      Booking.countDocuments({ restaurantId }),
      Booking.countDocuments({ restaurantId, status: 'confirmed' }),
      Booking.countDocuments({ restaurantId, status: 'checked_in' }),
      Booking.countDocuments({ restaurantId, status: 'completed' }),
      Booking.countDocuments({ restaurantId, status: 'pending' }),
      Booking.countDocuments({ restaurantId, status: 'cancelled' }),
      Booking.countDocuments({ restaurantId, status: { $in: ['no_show', 'no-show'] } }),
      Booking.aggregate([
        { $match: { restaurantId, status: { $in: ['confirmed', 'checked_in', 'completed'] } } },
        {
          $group: {
            _id: null,
            total: { $sum: getRevenueAmountExpression() },
          },
        },
      ]),
      Booking.aggregate([
        { $match: { restaurantId } },
        { $group: { _id: '$package', count: { $sum: 1 } } },
      ]),
      WeddingBooking.aggregate([
        { $match: { restaurantId } },
        {
          $group: {
            _id: '$bookingType',
            total: { $sum: 1 },
            open: { $sum: { $cond: [{ $not: [{ $in: ['$stage', ['confirmed', 'executed', 'feedback', 'follow_up', 'no_booking']] }] }, 1, 0] } },
            confirmed: { $sum: { $cond: [{ $eq: ['$stage', 'confirmed'] }, 1, 0] } },
          },
        },
      ]),
      RoomType.find({ restaurantId, isActive: true }).select('totalRooms').lean(),
      Menu.countDocuments({ restaurantId, isActive: true }),
      Setting.findOne({ restaurantId }).select('agentPrompt.revision').lean(),
    ]);
    const totalCustomers = totalCustomersArr.length;
    const totalRevenue = revenueRows[0]?.total || 0;
    const packageCounts = {};
    bookingsByPackage.forEach(({ _id, count }) => {
      const category = menuCategoryForPackage(_id) || 'Other';
      packageCounts[category] = (packageCounts[category] || 0) + count;
    });
    const pipelineByType = Object.fromEntries(eventPipelines.map((item) => [item._id, {
      total: item.total,
      open: item.open,
      confirmed: item.confirmed,
    }]));
    const roomInventory = {
      activeTypes: activeRoomTypes.length,
      totalRooms: activeRoomTypes.reduce((total, room) => total + Number(room.totalRooms || 0), 0),
    };

    const { start: todayStart, end: tomorrowStart } = getZonedDayBounds(
      new Date(),
      process.env.SLOT_TIMEZONE || 'Asia/Karachi',
    );

    const [todayChats, todayBookings] = await Promise.all([
      Chat.countDocuments({
        restaurantId,
        createdAt: { $gte: todayStart, $lt: tomorrowStart },
      }),
      Booking.countDocuments({
        restaurantId,
        createdAt: { $gte: todayStart, $lt: tomorrowStart },
      }),
    ]);

    const convertedBookings = confirmedBookings + checkedInBookings + completedBookings;
    const conversionRate =
      totalBookings > 0
        ? ((convertedBookings / totalBookings) * 100).toFixed(2)
        : '0.00';

    return res.status(200).json({
      success: true,
      overview: {
        totalChats,
        totalCustomers,
        totalBookings,
        confirmedBookings,
        checkedInBookings,
        completedBookings,
        pendingBookings,
        cancelledBookings,
        noShowBookings,
        totalRevenue,
        conversionRate: `${conversionRate}%`,
        todayChats,
        todayBookings,
        operations: {
          packageCounts,
          eventPipelines: {
            weddings: pipelineByType.wedding || { total: 0, open: 0, confirmed: 0 },
            corporate: pipelineByType.corporate || { total: 0, open: 0, confirmed: 0 },
          },
          roomInventory,
          activeMenus,
          aiPromptRevision: promptSetting?.agentPrompt?.revision || 0,
        },
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
    const days = Math.max(1, Math.min(365, parseInt(req.query.days || 7, 10) || 7));
    const timezone = process.env.SLOT_TIMEZONE || 'Asia/Karachi';

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const chatTimeline = await Chat.aggregate([
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
              timezone,
            },
          },
          chats: { $sum: 1 },
          customers: { $addToSet: '$customerPhone' },
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
              timezone,
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

    const byDate = new Map();
    chatTimeline.forEach((chat) => byDate.set(chat._id, {
      date: chat._id,
      chats: chat.chats,
      uniqueCustomers: chat.customers.filter(Boolean).length,
      bookings: 0,
      confirmedBookings: 0,
    }));
    bookingTimeline.forEach((booking) => {
      const day = byDate.get(booking._id) || {
        date: booking._id,
        chats: 0,
        uniqueCustomers: 0,
        bookings: 0,
        confirmedBookings: 0,
      };
      day.bookings = booking.bookings;
      day.confirmedBookings = booking.confirmed;
      byDate.set(booking._id, day);
    });
    const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

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

    const revenueStatuses = ['confirmed', 'checked_in', 'completed'];
    const amount = getRevenueAmountExpression();
    const packages = await Booking.aggregate([
      { $match: { restaurantId } },
      {
        $group: {
          _id: '$package',
          count: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $in: ['$status', revenueStatuses] }, amount, 0] } },
          avgPrice: { $avg: { $cond: [{ $in: ['$status', revenueStatuses] }, amount, null] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          checkedIn: { $sum: { $cond: [{ $eq: ['$status', 'checked_in'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          noShow: { $sum: { $cond: [{ $in: ['$status', ['no_show', 'no-show']] }, 1, 0] } },
          guests: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'no_show', 'no-show']] }, 0, { $ifNull: ['$numberOfPersons', 0] }] } },
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
    .sort('-createdAt')
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
        timestamp: chat.createdAt,
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