// realtime/socket.js
const { Server } = require("socket.io");

let io;

/**
 * ✅ Initialize Socket.IO with STRICT CORS
 */
const initSocket = (server) => {
  const allowedOrigins = [
    "https://crm-frontend-omega-six.vercel.app",
    "https://hotelcrmfrontend.vercel.app",
    "https://crm-frontend-fzlmf8woj-daniyal1.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5174",
    "http://localhost:5175"
  ];

  console.log(`
╔════════════════════════════════════════════╗
║ 🔌 SOCKET.IO INITIALIZATION               ║
╠════════════════════════════════════════════╣
║ Allowed Origins:
${allowedOrigins.map(o => `║ • ${o}`).join("\n")}
╚════════════════════════════════════════════╝
  `);

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`🚫 CORS Blocked Origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
    },
    path: "/socket.io/",
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["polling", "websocket"],
    maxHttpBufferSize: 1e6,
  });

  // ==================== CONNECTION HANDLERS ====================
  io.on("connection", (socket) => {
    console.log(`✅ NEW SOCKET CONNECTION | ID: ${socket.id}`);

    socket.on("join-chat-admins", () => {
      socket.join("chat-admins");
      const roomSize = io.sockets.adapter.rooms.get("chat-admins")?.size || 0;
      console.log(`👥 Admin joined chat-admins room. Total: ${roomSize}`);
    });

    socket.on("join-customer-room", (phone) => {
      if (phone) {
        socket.join(`customer-${phone}`);
        console.log(`📱 Customer room joined: customer-${phone}`);
      }
    });

    socket.on("disconnect", () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
    });

    socket.on("error", (error) => {
      console.error(`🔴 Socket Error [${socket.id}]:`, error);
    });
  });

  console.log("✅ Socket.IO initialized successfully with strict CORS");
  return io;
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  if (!io) {
    console.error("❌ Socket.IO not initialized yet!");
    return null;
  }
  return io;
};

module.exports = { initSocket, getIO };