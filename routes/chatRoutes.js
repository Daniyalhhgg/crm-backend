const express = require('express');
const router = express.Router();

const {
  getAllChats,
  getChatByCustomer,
  sendMessage,
  saveWhatsAppBotMessage
} = require('../controllers/chatController');

const auth = require('../middleware/auth');

// ======================
// 🔥 DEBUG: Check if functions are imported
// ======================
console.log('🔍 Chat Controller Functions:');
console.log('  - getAllChats:', typeof getAllChats);
console.log('  - getChatByCustomer:', typeof getChatByCustomer);
console.log('  - sendMessage:', typeof sendMessage);
console.log('  - saveWhatsAppBotMessage:', typeof saveWhatsAppBotMessage);

// ======================
// ✅ FIXED ORDER
// ======================

// 1. Public routes FIRST
if (typeof saveWhatsAppBotMessage === 'function') {
  router.post('/whatsapp', saveWhatsAppBotMessage);
  console.log('✅ Registered: POST /api/chats/whatsapp');
} else {
  console.error('❌ saveWhatsAppBotMessage is not a function');
}

// 2. Protected routes with specific paths
if (typeof sendMessage === 'function') {
  router.post('/send', auth, sendMessage);
  console.log('✅ Registered: POST /api/chats/send');
} else {
  console.error('❌ sendMessage is not a function');
}

if (typeof getChatByCustomer === 'function') {
  router.get('/customer/:phone', auth, getChatByCustomer);
  console.log('✅ Registered: GET /api/chats/customer/:phone');
} else {
  console.error('❌ getChatByCustomer is not a function');
}

// 3. General routes LAST
if (typeof getAllChats === 'function') {
  router.get('/', auth, getAllChats);
  console.log('✅ Registered: GET /api/chats');
} else {
  console.error('❌ getAllChats is not a function');
}

module.exports = router;