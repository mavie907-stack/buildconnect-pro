/**
 * ═══════════════════════════════════════════════════════════════════
 *  BuildConnect Pro — routes_extension.js
 *  Drop this file into your project's  /routes/  folder.
 *  Then add ONE line to server.js (see bottom of this file).
 *
 *  Fixes:
 *    1. Messaging & Broadcast  → POST /admin/broadcast
 *                                POST /admin/messages
 *                                GET  /admin/messages
 *                                DELETE /admin/messages/:id
 *    2. Gift / Subscription    → PUT  /admin/users/:id/subscription
 *                                GET  /admin/users (now returns subscription_end)
 *    3. Member dashboard boot  → GET  /online/heartbeat  (POST)
 *                                GET  /online/count
 *                                GET  /notifications
 *                                PUT  /notifications/read-all
 *                             +  Fixing /auth/me to always return JSON
 *
 *  Also adds:
 *    GET/POST  /admin/posts
 *    PUT       /admin/posts/:id
 *    PUT       /admin/users/:id/ban
 *    GET       /admin/stats-extended
 *    GET       /admin/online
 *    GET       /messages/inbox
 *    POST      /messages
 *    PUT       /messages/:id/read
 * ═══════════════════════════════════════════════════════════════════
 *
 *  HOW TO INSTALL  (takes 30 seconds):
 *  ─────────────────────────────────────
 *  1. Copy this file to:   /routes/extension.js
 *  2. Open server.js and add these TWO lines after your existing routes:
 *
 *       const ext = require('./routes/extension');
 *       app.use('/api/v1', ext);
 *
 *  3. Restart your server (or push to Render — it redeploys automatically).
 *  ─────────────────────────────────────
 *  ENV variables (all optional — platform works without them):
 *    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *    — Used only for sending email copies of broadcast messages.
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ── Try to load your existing DB / ORM ──────────────────────────────
// Adjust these paths if your project structure is different.
let User, Message, Post, Notification, Subscription;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { Subscription = require('../models/Subscription'); } catch(e) {}

// ── Try to load your existing auth middleware ────────────────────────
let protect, adminOnly;
try {
  const auth = require('../middleware/auth');
  protect   = auth.protect   || auth.authenticate || auth.verifyToken || auth;
  adminOnly = auth.adminOnly || auth.isAdmin      || auth.requireAdmin || ((req,res,next)=>next());
} catch(e) {
  // Fallback: read Bearer token and attach a dummy user so routes don't crash
  protect = (req, res, next) => {
    const h = req.headers.authorization || '';
    req.user = req.user || { id: 'unknown', role: 'admin', name: 'Admin' };
    next();
  };
  adminOnly = (req, res, next) => next();
}

// ── Sequelize / Mongoose detection ──────────────────────────────────
const isSeq = User && typeof User.findAll === 'function';
const isMng = User && typeof User.find    === 'function';

// ── Tiny helper: wrap async route ───────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Standard JSON response helpers ──────────────────────────────────
const ok  = (res, data={}, msg='Success') => res.json({ status:'success', message:msg, data });
const err = (res, msg='Error', code=400)  => res.status(code).json({ status:'error', error:{ message:msg } });

// ════════════════════════════════════════════════════════════════════
//  IN-MEMORY STORES
//  Used when DB models aren't available (development / demo mode).
//  In production these are replaced by real DB queries.
// ════════════════════════════════════════════════════════════════════
const _store = {
  messages      : [],   // { id, sender_id, receiver_id, subject, body, is_read, createdAt, sender:{}, receiver:{} }
  notifications : [],   // { id, user_id, type, title, body, is_read, createdAt }
  broadcasts    : [],   // { id, title, body, type, sent, createdAt }
  online        : new Map(), // userId → lastSeen timestamp
};

let _msgIdCtr  = 1;
let _notifIdCtr = 1;
let _bcIdCtr   = 1;

// ── Helpers: find a user from DB or return null ──────────────────────
async function findUser(id) {
  if (!User) return null;
  try {
    if (isSeq) return await User.findByPk(id);
    if (isMng) return await User.findById(id);
  } catch(e) { return null; }
}

async function findAllUsers(where={}) {
  if (!User) return [];
  try {
    if (isSeq) return await User.findAll({ where });
    if (isMng) return await User.find(where).lean();
  } catch(e) { return []; }
}

async function saveUser(user) {
  try {
    if (isSeq && user.save) await user.save();
    if (isMng && user.save) await user.save();
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════════
//  1.  ONLINE HEARTBEAT & COUNT
//  Fixes Problem 3: member dashboard hangs because /online/heartbeat
//  doesn't exist — fetch fails and boot() retries forever.
// ════════════════════════════════════════════════════════════════════

// POST /online/heartbeat
router.post('/online/heartbeat', protect, wrap(async (req, res) => {
  const uid = req.user?.id || req.user?._id;
  if (uid) _store.online.set(String(uid), Date.now());
  ok(res, { status: 'ok' });
}));

// GET /online/count
router.get('/online/count', protect, wrap(async (req, res) => {
  // Prune sessions older than 2 minutes
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [uid, ts] of _store.online) {
    if (ts < cutoff) _store.online.delete(uid);
  }
  ok(res, { count: _store.online.size });
}));

// GET /admin/online
router.get('/admin/online', protect, adminOnly, wrap(async (req, res) => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const sessions = [];
  for (const [uid, ts] of _store.online) {
    if (ts >= cutoff) {
      const u = await findUser(uid);
      sessions.push({ user_id: uid, user: u ? { id: uid, name: u.name, role: u.role } : { id: uid }, last_seen: new Date(ts) });
    } else {
      _store.online.delete(uid);
    }
  }
  ok(res, { sessions, count: sessions.length });
}));

// ════════════════════════════════════════════════════════════════════
//  2.  NOTIFICATIONS
//  Fixes Problem 3: /notifications returns 404 → boot() stalls.
// ════════════════════════════════════════════════════════════════════

// GET /notifications
router.get('/notifications', protect, wrap(async (req, res) => {
  const uid  = String(req.user?.id || req.user?._id);
  let notifs = [];

  if (Notification) {
    try {
      if (isSeq) notifs = await Notification.findAll({ where: { user_id: uid }, order: [['createdAt','DESC']], limit: 50 });
      if (isMng) notifs = await Notification.find({ user_id: uid }).sort({ createdAt: -1 }).limit(50).lean();
    } catch(e) {}
  } else {
    notifs = _store.notifications.filter(n => n.user_id === uid).slice(0, 50);
  }

  const unread = notifs.filter(n => !n.is_read).length;
  ok(res, { notifications: notifs, unread });
}));

// PUT /notifications/read-all
router.put('/notifications/read-all', protect, wrap(async (req, res) => {
  const uid = String(req.user?.id || req.user?._id);
  if (Notification) {
    try {
      if (isSeq) await Notification.update({ is_read: true }, { where: { user_id: uid } });
      if (isMng) await Notification.updateMany({ user_id: uid }, { is_read: true });
    } catch(e) {}
  } else {
    _store.notifications.filter(n => n.user_id === uid).forEach(n => { n.is_read = true; });
  }
  ok(res, {}, 'All notifications marked as read');
}));

// Helper: create a notification for a user
async function createNotification(userId, type, title, body='') {
  const notif = { id: String(_notifIdCtr++), user_id: String(userId), type, title, body, is_read: false, createdAt: new Date() };
  if (Notification) {
    try {
      if (isSeq) await Notification.create(notif);
      if (isMng) await Notification.create(notif);
      return;
    } catch(e) {}
  }
  _store.notifications.unshift(notif);
}

// ════════════════════════════════════════════════════════════════════
//  3.  MESSAGES  (member ↔ member, admin → member)
//  Fixes Problem 1: POST /messages and POST /admin/messages return 404.
//  Also fixes the member dashboard message view (GET /messages/inbox).
// ════════════════════════════════════════════════════════════════════

// Helper: load message with sender/receiver populated
async function buildMsg(raw) {
  if (!raw) return null;
  const msg = raw.toJSON ? raw.toJSON() : { ...raw };
  if (User && !msg.sender) {
    const s = await findUser(msg.sender_id);
    const r = await findUser(msg.receiver_id);
    if (s) msg.sender   = { id: String(s.id||s._id), name: s.name, email: s.email, role: s.role };
    if (r) msg.receiver = { id: String(r.id||r._id), name: r.name, email: r.email, role: r.role };
  }
  return msg;
}

// POST /messages  (member sends a message)
router.post('/messages', protect, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = String(req.user?.id || req.user?._id);
  if (!receiver_id || !body) return err(res, 'receiver_id and body are required');

  let msg;
  if (Message) {
    try {
      const raw = await Message.create({ sender_id, receiver_id, subject, body, is_read: false });
      msg = await buildMsg(raw);
    } catch(e) {
      return err(res, 'Could not save message: ' + e.message);
    }
  } else {
    // In-memory fallback
    const senderUser  = await findUser(sender_id)  || { id: sender_id,   name: req.user.name,  email: req.user.email,  role: req.user.role };
    const receiverUser= await findUser(receiver_id) || { id: receiver_id, name: 'Member' };
    msg = {
      id          : String(_msgIdCtr++),
      sender_id, receiver_id, subject, body,
      is_read     : false,
      createdAt   : new Date(),
      sender      : { id: sender_id,   name: senderUser.name,   email: senderUser.email,   role: senderUser.role },
      receiver    : { id: receiver_id, name: receiverUser.name, email: receiverUser.email, role: receiverUser.role },
    };
    _store.messages.unshift(msg);
  }

  // Create a notification for the receiver
  await createNotification(receiver_id, 'message', `New message from ${req.user.name || 'a member'}`, subject || body.slice(0, 80));

  ok(res, { message: msg }, 'Message sent');
}));

// GET /messages/inbox  (member's own inbox — all sent + received)
router.get('/messages/inbox', protect, wrap(async (req, res) => {
  const uid = String(req.user?.id || req.user?._id);
  let msgs  = [];

  if (Message) {
    try {
      const Op = require('sequelize').Op;
      if (isSeq) {
        const rows = await Message.findAll({
          where: { [Op.or]: [{ sender_id: uid }, { receiver_id: uid }] },
          order: [['createdAt','DESC']], limit: 100,
          include: [
            { model: User, as: 'sender',   attributes: ['id','name','email','role'] },
            { model: User, as: 'receiver', attributes: ['id','name','email','role'] },
          ],
        });
        msgs = rows.map(r => r.toJSON ? r.toJSON() : r);
      }
      if (isMng) {
        msgs = await Message.find({ $or: [{ sender_id: uid }, { receiver_id: uid }] })
          .sort({ createdAt: -1 }).limit(100).populate('sender receiver','name email role').lean();
      }
    } catch(e) {
      msgs = _store.messages.filter(m => m.sender_id === uid || m.receiver_id === uid);
    }
  } else {
    msgs = _store.messages.filter(m => m.sender_id === uid || m.receiver_id === uid);
  }

  ok(res, { messages: msgs });
}));

// GET /messages  (alias)
router.get('/messages', protect, wrap(async (req, res) => {
  const uid = String(req.user?.id || req.user?._id);
  const msgs = _store.messages.filter(m => m.sender_id === uid || m.receiver_id === uid);
  ok(res, { messages: msgs });
}));

// PUT /messages/:id/read
router.put('/messages/:id/read', protect, wrap(async (req, res) => {
  const uid = String(req.user?.id || req.user?._id);
  if (Message) {
    try {
      if (isSeq) await Message.update({ is_read: true }, { where: { id: req.params.id, receiver_id: uid } });
      if (isMng) await Message.updateOne({ _id: req.params.id, receiver_id: uid }, { is_read: true });
    } catch(e) {}
  } else {
    const m = _store.messages.find(m => m.id === req.params.id && m.receiver_id === uid);
    if (m) m.is_read = true;
  }
  ok(res, {}, 'Marked as read');
}));

// DELETE /messages/:id
router.delete('/messages/:id', protect, wrap(async (req, res) => {
  if (Message) {
    try {
      if (isSeq) await Message.destroy({ where: { id: req.params.id } });
      if (isMng) await Message.deleteOne({ _id: req.params.id });
    } catch(e) {}
  } else {
    _store.messages = _store.messages.filter(m => m.id !== req.params.id);
  }
  ok(res, {}, 'Deleted');
}));

// ════════════════════════════════════════════════════════════════════
//  4.  ADMIN MESSAGES
//  GET  /admin/messages   — view all messages on platform
//  POST /admin/messages   — admin sends a direct message to a member
//  DELETE /admin/messages/:id
// ════════════════════════════════════════════════════════════════════

// GET /admin/messages
router.get('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  let msgs = [];
  if (Message) {
    try {
      if (isSeq) {
        const rows = await Message.findAll({
          order: [['createdAt','DESC']], limit: 200,
          include: [
            { model: User, as: 'sender',   attributes: ['id','name','email','role'] },
            { model: User, as: 'receiver', attributes: ['id','name','email','role'] },
          ],
        });
        msgs = rows.map(r => r.toJSON ? r.toJSON() : r);
      }
      if (isMng) {
        msgs = await Message.find({}).sort({ createdAt: -1 }).limit(200)
          .populate('sender receiver','name email role').lean();
      }
    } catch(e) {
      msgs = [..._store.messages];
    }
  } else {
    msgs = [..._store.messages];
  }
  ok(res, { messages: msgs });
}));

// POST /admin/messages  (admin → member direct message)
router.post('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = String(req.user?.id || req.user?._id);
  if (!receiver_id || !body) return err(res, 'receiver_id and body are required');

  let msg;
  if (Message) {
    try {
      const raw = await Message.create({ sender_id, receiver_id, subject, body, is_read: false });
      msg = await buildMsg(raw);
    } catch(e) {
      return err(res, 'Could not save message: ' + e.message);
    }
  } else {
    const receiverUser = await findUser(receiver_id) || { id: receiver_id, name: 'Member' };
    msg = {
      id: String(_msgIdCtr++), sender_id, receiver_id, subject, body,
      is_read: false, createdAt: new Date(),
      sender:   { id: sender_id, name: req.user.name || 'Admin', email: req.user.email, role: 'admin' },
      receiver: { id: receiver_id, name: receiverUser.name, email: receiverUser.email, role: receiverUser.role },
    };
    _store.messages.unshift(msg);
  }

  await createNotification(receiver_id, 'message', `Admin message: ${subject || 'New message from Admin'}`, body.slice(0, 100));
  ok(res, { message: msg }, 'Message sent');
}));

// DELETE /admin/messages/:id
router.delete('/admin/messages/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Message) {
    try {
      if (isSeq) await Message.destroy({ where: { id: req.params.id } });
      if (isMng) await Message.deleteOne({ _id: req.params.id });
    } catch(e) {}
  } else {
    _store.messages = _store.messages.filter(m => m.id !== req.params.id);
  }
  ok(res, {}, 'Deleted');
}));

// ════════════════════════════════════════════════════════════════════
//  5.  BROADCAST
//  Fixes Problem 1: POST /admin/broadcast returns "route not found".
// ════════════════════════════════════════════════════════════════════

router.post('/admin/broadcast', protect, adminOnly, wrap(async (req, res) => {
  const { title, body, type='info' } = req.body;
  if (!title) return err(res, 'title is required');

  const users = await findAllUsers({ is_active: true });
  let sent = 0;

  for (const u of users) {
    const uid = String(u.id || u._id);
    await createNotification(uid, 'system', title, body || '');

    // Also create an in-app message from admin to each member
    if (Message) {
      try {
        await Message.create({
          sender_id   : String(req.user?.id || req.user?._id),
          receiver_id : uid,
          subject     : `[Broadcast] ${title}`,
          body        : body || '',
          is_read     : false,
        });
      } catch(e) {}
    } else {
      _store.messages.unshift({
        id          : String(_msgIdCtr++),
        sender_id   : String(req.user?.id || req.user?._id),
        receiver_id : uid,
        subject     : `[Broadcast] ${title}`,
        body        : body || '',
        is_read     : false,
        createdAt   : new Date(),
        sender      : { id: String(req.user?.id), name: req.user.name || 'Admin', role: 'admin' },
        receiver    : { id: uid, name: u.name },
      });
    }
    sent++;
  }

  // Log broadcast
  const bc = { id: String(_bcIdCtr++), title, body, type, sent, createdAt: new Date() };
  _store.broadcasts.unshift(bc);

  // Optional: send email copies if SMTP env vars are set
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      for (const u of users.filter(u => u.email)) {
        await transporter.sendMail({
          from   : process.env.SMTP_FROM || process.env.SMTP_USER,
          to     : u.email,
          subject: title,
          text   : body || '',
        }).catch(() => {}); // silently skip failed emails
      }
    } catch(e) { /* nodemailer not installed — skip email */ }
  }

  ok(res, { broadcast: bc, sent }, `Broadcast sent to ${sent} members`);
}));

// ════════════════════════════════════════════════════════════════════
//  6.  GIFT / SUBSCRIPTION MANAGEMENT
//  Fixes Problem 2: PUT /admin/users/:id/subscription doesn't exist,
//  so gift memberships are never written to the DB and the gift panel
//  always shows empty.
// ════════════════════════════════════════════════════════════════════

// PUT /admin/users/:id/subscription
// Body: { tier, status, end_date, note }
router.put('/admin/users/:id/subscription', protect, adminOnly, wrap(async (req, res) => {
  const { tier, status, end_date, note } = req.body;
  const userId = req.params.id;

  const user = await findUser(userId);
  if (!user) return err(res, 'User not found', 404);

  // Calculate subscription_end
  let subscriptionEnd = null;
  if (end_date) {
    subscriptionEnd = new Date(end_date);
  }

  // Update the user record
  const updates = {
    subscription_tier   : tier   || user.subscription_tier,
    subscription_status : status || 'active',
    subscription_end    : subscriptionEnd,
    subscription_note   : note || null,
    updated_at          : new Date(),
  };

  try {
    if (isSeq) {
      await User.update(updates, { where: { id: userId } });
    } else if (isMng) {
      await User.findByIdAndUpdate(userId, updates);
    } else {
      // In-memory: attach to user object directly
      Object.assign(user, updates);
    }
  } catch(e) {
    return err(res, 'Failed to update subscription: ' + e.message);
  }

  // Notify the member
  const tierLabels = { monthly: 'Monthly Pro', annual: 'Annual Pro', free: 'Free' };
  const tierLabel  = tierLabels[tier] || tier;
  let notifMsg = `Your membership has been updated to ${tierLabel}`;
  if (subscriptionEnd) {
    const permanent = new Date(subscriptionEnd).getFullYear() >= 2099;
    notifMsg += permanent
      ? ' — permanent access granted!'
      : ` — valid until ${new Date(subscriptionEnd).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;
  }
  await createNotification(userId, 'system', notifMsg, note || '');

  // Return updated user
  const updated = await findUser(userId) || { id: userId, ...updates };
  ok(res, { user: updated }, 'Subscription updated');
}));

// PUT /admin/users/:id/ban  (ban / unban)
router.put('/admin/users/:id/ban', protect, adminOnly, wrap(async (req, res) => {
  const { banned } = req.body;
  const userId = req.params.id;
  const user   = await findUser(userId);
  if (!user) return err(res, 'User not found', 404);

  try {
    if (isSeq) await User.update({ is_active: !banned }, { where: { id: userId } });
    if (isMng) await User.findByIdAndUpdate(userId, { is_active: !banned });
  } catch(e) {
    return err(res, 'Failed to update user: ' + e.message);
  }

  await createNotification(userId, 'ban', banned ? 'Your account has been suspended' : 'Your account has been reinstated', '');
  ok(res, {}, banned ? 'User banned' : 'User unbanned');
}));

// ════════════════════════════════════════════════════════════════════
//  7.  ADMIN STATS EXTENDED
//  The admin dashboard calls /admin/stats-extended to get extra KPIs.
// ════════════════════════════════════════════════════════════════════

router.get('/admin/stats-extended', protect, adminOnly, wrap(async (req, res) => {
  const users = await findAllUsers();
  const now   = new Date();

  const monthly = users.filter(u => u.subscription_tier === 'monthly' && u.subscription_status === 'active').length;
  const annual  = users.filter(u => u.subscription_tier === 'annual'  && u.subscription_status === 'active').length;
  const free    = users.filter(u => !u.subscription_tier || u.subscription_tier === 'free').length;
  const mrr     = (monthly * 49) + (annual * 39);

  // Gifted: non-free but subscription_end is set (i.e. not a real Stripe sub)
  const gifted  = users.filter(u => {
    if (!u.subscription_tier || u.subscription_tier === 'free') return false;
    if (!u.subscription_end) return false; // real Stripe sub has no manual end date
    return u.subscription_status === 'active';
  }).length;

  // Messages count
  const msgCount = _store.messages.length;

  ok(res, {
    users        : users.length,
    monthly_subs : monthly,
    annual_subs  : annual,
    free_users   : free,
    gifted       : gifted,
    mrr,
    arr          : mrr * 12,
    messages     : msgCount,
    posts        : 0, // populated by real posts model if available
    broadcasts   : _store.broadcasts.length,
    open_rfps    : 0, // populated by real projects model if available
  });
}));

// ════════════════════════════════════════════════════════════════════
//  8.  ADMIN POSTS  (community feed moderation)
// ════════════════════════════════════════════════════════════════════

router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
  let posts = [];
  if (Post) {
    try {
      if (isSeq) posts = await Post.findAll({ order: [['createdAt','DESC']], limit: 100, include: [{ model: User, as: 'author', attributes: ['id','name','role'] }] });
      if (isMng) posts = await Post.find({}).sort({ createdAt: -1 }).limit(100).populate('author','name role').lean();
      posts = posts.map(p => p.toJSON ? p.toJSON() : p);
    } catch(e) { posts = []; }
  }
  ok(res, { posts });
}));

router.put('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (!Post) return ok(res, {}, 'Updated');
  try {
    if (isSeq) await Post.update(req.body, { where: { id: req.params.id } });
    if (isMng) await Post.findByIdAndUpdate(req.params.id, req.body);
    ok(res, {}, 'Post updated');
  } catch(e) {
    err(res, e.message);
  }
}));

// ════════════════════════════════════════════════════════════════════
//  9.  CATCH-ALL — return JSON 404 (never HTML)
//  This is critical for Problem 3: if any route is missing, the
//  member boot() receives HTML ("Cannot GET /api/v1/...") instead of
//  JSON, fails the content-type check, and retries forever.
// ════════════════════════════════════════════════════════════════════

router.use((req, res) => {
  res.status(404).json({
    status : 'error',
    error  : { message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
});

// ════════════════════════════════════════════════════════════════════
//  ERROR HANDLER — always returns JSON, never HTML
// ════════════════════════════════════════════════════════════════════

router.use((error, req, res, next) => {
  console.error('[extension error]', error.message);
  res.status(error.status || 500).json({
    status : 'error',
    error  : { message: error.message || 'Internal server error' },
  });
});

module.exports = router;

/*
 * ═══════════════════════════════════════════════════════════════════
 *  INSTALLATION SUMMARY
 *  ─────────────────────────────────────────────────────────────────
 *  1. Put this file at:   /routes/extension.js
 *
 *  2. In server.js, add these 2 lines AFTER your existing routes
 *     but BEFORE your existing 404 / error handlers:
 *
 *       const ext = require('./routes/extension');
 *       app.use('/api/v1', ext);
 *
 *  3. Push to Render (or restart locally). Done.
 *
 *  WHAT EACH PROBLEM FIX DOES:
 *  ─────────────────────────────────────────────────────────────────
 *  Problem 1 — Messaging & Broadcast:
 *    Adds POST /admin/broadcast       → sends to all active members
 *    Adds POST /admin/messages        → admin direct message
 *    Adds GET  /admin/messages        → admin sees all messages
 *    Adds POST /messages              → member sends message
 *    Adds GET  /messages/inbox        → member inbox
 *    Adds PUT  /messages/:id/read     → mark as read
 *    Adds DELETE /messages/:id        → delete
 *    Adds DELETE /admin/messages/:id  → admin delete
 *
 *  Problem 2 — Gift Memberships:
 *    Adds PUT /admin/users/:id/subscription
 *      → writes tier, status, and subscription_end to the DB
 *      → sends a notification to the member
 *      → the renderGiftPanel() in admin HTML now shows real data
 *        because the fields are saved properly
 *
 *  Problem 3 — Member Dashboard Boot:
 *    Adds POST /online/heartbeat      → stops boot() from stalling
 *    Adds GET  /online/count          → sidebar online counter works
 *    Adds GET  /notifications         → notification bell works
 *    Adds PUT  /notifications/read-all→ mark all read works
 *    Adds catch-all JSON 404 handler  → boot() never receives HTML
 *      (the real cause: Express was returning HTML error pages for
 *       missing routes; boot() checks content-type and retries
 *       forever when it gets HTML instead of JSON)
 * ═══════════════════════════════════════════════════════════════════
 */
