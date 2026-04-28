const express = require('express');
const router = express.Router();

const {
  getDashboardOverview,
  getActivityTimeline,
  getPopularPackages,
  getBookingTrends,
  getRecentActivity,
} = require('../controllers/dashboardController');

const auth = require('../middleware/auth');


// ==============================
// 📊 DASHBOARD OVERVIEW
// ==============================
router.get('/overview', auth, getDashboardOverview);


// ==============================
// 📅 ACTIVITY TIMELINE (GRAPH DATA)
// ==============================
router.get('/timeline', auth, getActivityTimeline);


// ==============================
// 🍽️ POPULAR PACKAGES
// ==============================
router.get('/packages', auth, getPopularPackages);


// ==============================
// 📈 BOOKING + STATUS TRENDS
// ==============================
router.get('/trends', auth, getBookingTrends);


// ==============================
// 🔥 RECENT ACTIVITY FEED
// ==============================
router.get('/activity', auth, getRecentActivity);


module.exports = router;