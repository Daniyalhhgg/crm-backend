// require('dotenv').config();

// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const helmet = require('helmet');
// const http = require('http');

// const app = express();
// const server = http.createServer(app);

// // ======================
// // SOCKET.IO SETUP
// // ======================
// const { initSocket } = require('./realtime/socket');

// const io = initSocket(server);
// app.set('io', io);

// // ======================
// // MIDDLEWARE
// // ======================
// app.use(helmet());

// app.use(cors({
//   origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'],
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));

// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true }));

// // ======================
// // 🔥 DATABASE CONNECTION (FIXED)
// // ======================
// mongoose.connect(process.env.MONGODB_URI)
//   // Removed deprecated options ✅
//   .then(() => {
//     console.log('✅ MongoDB Connected Successfully');
//     console.log(`📊 Database: ${mongoose.connection.name}`);
//   })
//   .catch(err => {
//     console.error('❌ MongoDB Connection Error:', err.message);
//     process.exit(1);
//   });

// // Connection events
// mongoose.connection.on('disconnected', () => {
//   console.warn('⚠️ MongoDB Disconnected');
// });

// mongoose.connection.on('error', (err) => {
//   console.error('❌ MongoDB Error:', err.message);
// });

// // ======================
// // ROOT ROUTE
// // ======================
// app.get('/', (req, res) => {
//   res.json({
//     success: true,
//     message: 'Hotel d\'GATES CRM API',
//     version: '1.0.0',
//     status: 'running',
//     socket: io ? 'enabled' : 'disabled',
//     mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
//     endpoints: {
//       auth: '/api/auth/login, /api/auth/register, /api/auth/me, /api/auth/logout',
//       chats: '/api/chats, /api/chats/whatsapp, /api/chats/send, /api/chats/customer/:phone',
//       bookings: '/api/bookings, /api/bookings/:id, /api/bookings/from-whatsapp',
//       customers: '/api/customers, /api/customers/:phone/details',
//       dashboard: '/api/dashboard/overview, /api/dashboard/timeline, /api/dashboard/packages',
//       webhook: '/api/webhook/live-event'
//     }
//   });
// });

// // ======================
// // ROUTES
// // ======================
// app.use('/api/auth', require('./routes/authRoutes'));
// app.use('/api/chats', require('./routes/chatRoutes'));
// app.use('/api/bookings', require('./routes/bookingRoutes'));
// app.use('/api/customers', require('./routes/customerRoutes'));
// app.use('/api/dashboard', require('./routes/dashboardRoutes'));
// app.use('/api/webhook', require('./routes/webhookRoutes'));

// // ======================
// // HEALTH CHECK
// // ======================
// app.get('/health', (req, res) => {
//   res.json({
//     status: 'OK',
//     timestamp: new Date().toISOString(),
//     uptime: process.uptime(),
//     memory: {
//       used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
//       total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
//     },
//     socket: {
//       enabled: io ? true : false,
//       connected: io ? io.engine.clientsCount : 0
//     },
//     mongo: {
//       status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
//       dbName: mongoose.connection.name || 'unknown',
//       host: mongoose.connection.host || 'unknown'
//     },
//     port: PORT,
//     node: process.version
//   });
// });

// // ======================
// // 404 HANDLER
// // ======================
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: `Route not found: ${req.originalUrl}`,
//     method: req.method,
//     hint: 'Please check the API documentation or visit / for available endpoints',
//     availableRoutes: {
//       root: 'GET /',
//       health: 'GET /health',
//       auth: {
//         login: 'POST /api/auth/login',
//         register: 'POST /api/auth/register',
//         getCurrentAdmin: 'GET /api/auth/me',
//         logout: 'POST /api/auth/logout'
//       },
//       chats: {
//         getAll: 'GET /api/chats',
//         getByCustomer: 'GET /api/chats/customer/:phone',
//         sendMessage: 'POST /api/chats/send',
//         saveWhatsAppMessage: 'POST /api/chats/whatsapp'
//       },
//       bookings: {
//         getAll: 'GET /api/bookings',
//         getById: 'GET /api/bookings/:id',
//         create: 'POST /api/bookings',
//         createFromWhatsApp: 'POST /api/bookings/from-whatsapp',
//         updateStatus: 'PUT /api/bookings/:id'
//       },
//       customers: {
//         getAll: 'GET /api/customers',
//         getDetails: 'GET /api/customers/:phone/details'
//       },
//       dashboard: {
//         overview: 'GET /api/dashboard/overview',
//         timeline: 'GET /api/dashboard/timeline',
//         packages: 'GET /api/dashboard/packages',
//         trends: 'GET /api/dashboard/trends',
//         activity: 'GET /api/dashboard/activity'
//       },
//       webhook: {
//         handleEvent: 'POST /api/webhook/live-event'
//       }
//     }
//   });
// });

// // ======================
// // GLOBAL ERROR HANDLER
// // ======================
// app.use((err, req, res, next) => {
//   console.error('🔴 Server Error:', {
//     message: err.message,
//     stack: err.stack,
//     url: req.originalUrl,
//     method: req.method
//   });

//   const statusCode = err.statusCode || 500;
//   const isDevelopment = process.env.NODE_ENV === 'development';

//   res.status(statusCode).json({
//     success: false,
//     message: isDevelopment ? err.message : 'Internal Server Error',
//     error: isDevelopment ? {
//       type: err.constructor.name,
//       stack: err.stack
//     } : undefined,
//     timestamp: new Date().toISOString()
//   });
// });

// // ======================
// // START SERVER
// // ======================
// const PORT = process.env.PORT || 5000;

// server.listen(PORT, () => {
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`🚀 Server is running on http://localhost:${PORT}`);
//   console.log(`🔌 Socket.io is ready on ws://localhost:${PORT}`);
//   console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
//   console.log(`\n📍 API Documentation:`);
//   console.log(`   - Root: http://localhost:${PORT}/`);
//   console.log(`   - Health: http://localhost:${PORT}/health`);
//   console.log(`\n${'='.repeat(60)}\n`);
// });

// // ======================
// // GRACEFUL SHUTDOWN
// // ======================
// process.on('SIGTERM', () => {
//   console.log('\n🛑 SIGTERM signal received: closing HTTP server');
//   server.close(() => {
//     console.log('✅ HTTP server closed');
//     mongoose.disconnect();
//     process.exit(0);
//   });
// });

// process.on('SIGINT', () => {
//   console.log('\n🛑 SIGINT signal received: closing HTTP server');
//   server.close(() => {
//     console.log('✅ HTTP server closed');
//     mongoose.disconnect();
//     process.exit(0);
//   });
// });

// process.on('uncaughtException', (err) => {
//   console.error('💥 Uncaught Exception:', err);
//   process.exit(1);
// });

// process.on('unhandledRejection', (reason, promise) => {
//   console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
//   process.exit(1);
// });
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');

const app = express();
const server = http.createServer(app);

// ======================
// SOCKET.IO SETUP
// ======================
const { initSocket } = require('./realtime/socket');
const io = initSocket(server);
app.set('io', io);

// ======================
// MIDDLEWARE
// ======================
app.use(helmet());

// ✅ FIXED CORS (PRODUCTION READY)
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://crm-frontend-fzlmf8woj-daniyal1.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// ✅ Handle preflight requests (IMPORTANT FIX)
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================
// REQUEST LOGGER
// ======================
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.originalUrl}`);
  next();
});

// ======================
// DATABASE
// ======================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
  })
  .catch(err => {
    console.error('❌ Mongo Error:', err.message);
    process.exit(1);
  });

// ======================
// ROOT
// ======================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API RUNNING'
  });
});

// ======================
// TEST ROUTE
// ======================
app.get('/api/test', (req, res) => {
  console.log("🔥 TEST ROUTE HIT");
  res.json({ success: true });
});

// ======================
// ROUTES
// ======================
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/webhook', require('./routes/webhookRoutes'));

// ======================
// HUMAN MODE ROUTES (SAFE LOAD)
// ======================
try {
  const humanModeRoutes = require('./routes/humanModeRoutes');

  app.use('/api/human-mode', (req, res, next) => {
    console.log("🔥 HUMAN MODE ROUTE HIT");
    next();
  });

  app.use('/api/human-mode', humanModeRoutes);

  console.log("🚀 HUMAN MODE ROUTES REGISTERED");

} catch (err) {
  console.error("❌ humanModeRoutes error:", err.message);
}

// ======================
// FALLBACK ROUTE
// ======================
app.get('/api/human-mode/check/:phone', (req, res) => {
  console.log("⚡ FALLBACK ROUTE HIT");
  res.json({
    success: true,
    fallback: true,
    phone: req.params.phone
  });
});

// ======================
// HEALTH CHECK
// ======================
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// ======================
// 404 HANDLER
// ======================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`
  });
});

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

//MONGODB_URI=mongodb+srv://DANIYAL:Daniyal1234@cluster0.ospq1ut.mongodb.net/restaurant-crm?retryWrites=true&w=majority&appName=Cluster0
