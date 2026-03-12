// socket.js — gracefully disabled if socket.io not installed
let io;
const onlineUsers = new Map();

function initSocket(httpServer) {
  let Server;
  try { Server = require('socket.io').Server; } catch(e) {
    console.warn('[socket] socket.io not installed — real-time disabled. Run: npm install socket.io');
    return null;
  }
  const jwt = require('jsonwebtoken');
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET','POST'] },
    pingTimeout: 60000, pingInterval: 25000,
  });
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'buildconnect_secret');
      socket.userId   = String(decoded.id || decoded.userId);
      socket.userRole = decoded.role || 'professional';
      next();
    } catch(e) { next(new Error('Invalid token')); }
  });
  io.on('connection', socket => {
    const uid = socket.userId;
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);
    socket.join(`user:${uid}`);
    io.emit('online:count', { count: onlineUsers.size });
    io.emit('online:list',  { userIds: [...onlineUsers.keys()] });
    socket.on('typing:start', ({ toUserId }) => io.to(`user:${toUserId}`).emit('typing:start', { fromUserId: uid }));
    socket.on('typing:stop',  ({ toUserId }) => io.to(`user:${toUserId}`).emit('typing:stop',  { fromUserId: uid }));
    socket.on('post:react', data => socket.broadcast.emit('post:react', data));
    socket.on('disconnect', () => {
      const s = onlineUsers.get(uid);
      if (s) { s.delete(socket.id); if (!s.size) onlineUsers.delete(uid); }
      io.emit('online:count', { count: onlineUsers.size });
      io.emit('online:list',  { userIds: [...onlineUsers.keys()] });
    });
  });
  console.log('[socket] Socket.io initialized ✅');
  return io;
}

function emitToUser(userId, event, data) { if (io) io.to(`user:${String(userId)}`).emit(event, data); }
function broadcast(event, data)          { if (io) io.emit(event, data); }
function getOnlineCount() { return onlineUsers.size; }
function getOnlineIds()   { return [...onlineUsers.keys()]; }
function isOnline(userId) { return onlineUsers.has(String(userId)); }

module.exports = { initSocket, emitToUser, broadcast, getOnlineCount, getOnlineIds, isOnline };
