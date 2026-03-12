// ═══════════════════════════════════════════════════════════════════
//  BuildConnect Pro — Socket.io real-time server
//  Attach to HTTP server in server.js:
//    const { initSocket, getIO } = require('./socket');
//    const httpServer = require('http').createServer(app);
//    initSocket(httpServer);
// ═══════════════════════════════════════════════════════════════════
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;
// userId → Set of socket ids (one user can have multiple tabs)
const onlineUsers = new Map();

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET','POST'] },
    pingTimeout  : 60000,
    pingInterval : 25000,
  });

  // ── Auth middleware ──────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'buildconnect_secret');
      socket.userId = String(decoded.id || decoded.userId);
      socket.userRole = decoded.role || 'professional';
      next();
    } catch(e) { next(new Error('Invalid token')); }
  });

  // ── Connection ───────────────────────────────────────────────────
  io.on('connection', socket => {
    const uid = socket.userId;
    console.log(`[socket] ✅ ${uid} connected (${socket.id})`);

    // Track online
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);

    // Join personal room so we can target this user directly
    socket.join(`user:${uid}`);

    // Broadcast updated online count to everyone
    io.emit('online:count', { count: onlineUsers.size });
    io.emit('online:list',  { userIds: [...onlineUsers.keys()] });

    // ── Typing indicators ────────────────────────────────────────
    socket.on('typing:start', ({ toUserId }) => {
      io.to(`user:${toUserId}`).emit('typing:start', { fromUserId: uid });
    });
    socket.on('typing:stop', ({ toUserId }) => {
      io.to(`user:${toUserId}`).emit('typing:stop', { fromUserId: uid });
    });

    // ── Post reactions (instant across all open tabs) ────────────
    socket.on('post:react', (data) => {
      socket.broadcast.emit('post:react', data);
    });

    // ── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(uid);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) onlineUsers.delete(uid);
      }
      io.emit('online:count', { count: onlineUsers.size });
      io.emit('online:list',  { userIds: [...onlineUsers.keys()] });
      console.log(`[socket] ❌ ${uid} disconnected`);
    });
  });

  console.log('[socket] Socket.io initialized ✅');
  return io;
}

// Helper: emit to a specific user (used by routes)
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${String(userId)}`).emit(event, data);
}

// Helper: broadcast to everyone
function broadcast(event, data) {
  if (!io) return;
  io.emit(event, data);
}

function getIO() { return io; }
function getOnlineCount() { return onlineUsers.size; }
function getOnlineIds() { return [...onlineUsers.keys()]; }
function isOnline(userId) { return onlineUsers.has(String(userId)); }

module.exports = { initSocket, getIO, emitToUser, broadcast, getOnlineCount, getOnlineIds, isOnline };
