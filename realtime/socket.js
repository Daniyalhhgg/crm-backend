const { Server } = require("socket.io");

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"]
  });

  io.on("connection", (socket) => {
    console.log(`✅ Socket connected: ${socket.id}`);

    // Admin join chat admins room
    socket.on("join-chat-admins", () => {
      socket.join("chat-admins");
      console.log(`👥 Admin ${socket.id} joined chat-admins room`);
    });

    // Join specific customer room
    socket.on("join-room", (phoneNumber) => {
      socket.join(`chat-${phoneNumber}`);
      console.log(`📱 Socket ${socket.id} joined room: chat-${phoneNumber}`);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error(`🔴 Socket error [${socket.id}]:`, error);
    });
  });

  console.log("🔌 Socket.io initialized");
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
};

module.exports = { initSocket, getIO };