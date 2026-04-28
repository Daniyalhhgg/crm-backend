const express = require('express');
const router = express.Router();

const {
  getAllCustomers,
  getCustomerDetails,
  getCustomerByPhone
} = require('../controllers/customerController');

const auth = require('../middleware/auth');

// ======================
// 🔥 DEBUG: Check if functions are imported
// ======================
console.log('🔍 Customer Controller Functions:');
console.log('  - getAllCustomers:', typeof getAllCustomers);
console.log('  - getCustomerDetails:', typeof getCustomerDetails);
console.log('  - getCustomerByPhone:', typeof getCustomerByPhone);

// ======================
// ✅ FIXED ORDER
// ======================

// 1. Specific routes FIRST
if (typeof getCustomerDetails === 'function') {
  router.get('/:phone/details', auth, getCustomerDetails);
  console.log('✅ Registered: GET /api/customers/:phone/details');
} else {
  console.error('❌ getCustomerDetails is not a function');
}

// 2. General routes LAST
if (typeof getAllCustomers === 'function') {
  router.get('/', auth, getAllCustomers);
  console.log('✅ Registered: GET /api/customers');
} else {
  console.error('❌ getAllCustomers is not a function');
}

module.exports = router;