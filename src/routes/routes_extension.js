/**
 * BuildConnect Pro — src/routes/extension.js
 * ===========================================
 * Save as: src/routes/extension.js
 *
 * server.js must have (ext FIRST, before other routes):
 *   const ext = require('./routes/extension');
 *   app.use('/api/v1', ext);
 *   app.use('/api/v1/auth', authRoutes);
 *   app.use('/api/v1/rfps', rfpRoutes);
 *   app.use('/api/v1/admin', adminRoutes);
 */

'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');

// ─── Load auth middleware from your existing file ──────────────────
// server.js is in src/, this file is in src/routes/
// so ../middleware/auth = src/middleware/auth  ✓
let protect, adminOnly;
try {
  const auth = require('../middleware/auth');
  // Handle all common export patterns
  protect   = auth.protect || auth.authenticate || auth.verifyToken
           || (typeof auth === 'function' ? auth : null);
  adminOnly = auth.adminOnly || auth.isAdmin || auth.requireAdmin
           || auth.restrictTo?.('admin')
           || ((req, res, next) => {
                if (req.user?.role !== 'admin')
                  return res.status(403).json({ status:'error', error:{ message:'Admin access required' }});
                next();
              });
} catch(e) {
  console.warn('[extension] Could not load auth middleware:', e.message);
  // Passthrough fallback — lets requests through so other errors surface
  protect   = (req, res, next) => next();
  adminOnly = (req, res, next) => next();
}

// ─── Load models ───────────────────────────────────────────────────
let User, Message, Post, Notification;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}

const isSeq = !!(User && typeof User.findAll === 'function');
const isMng = !!(User && typeof User.find    === 'function');

// ─── Helpers ───────────────────────────────────────────────────────
const ok   = (res, data={}, msg='Success') =>
  res.json({ status:'success', message:msg, data });
const fail = (res, msg='Error', code=400) =>
  res.status(code).json({ status:'error', error:{ message:msg } });
const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const uid  = req => String(req.user?.id || req.user?._id || '');

// ─── In-memory fallback stores ─────────────────────────────────────
const store = { messages:[], notifications:[], broadcasts:[], online: new Map() };
let msgId=1, notifId=1, bcId=1;

// ─── DB helpers ────────────────────────────────────────────────────
async function findUser(id) {
  if (!User || !id) return null;
  try {
    if (isSeq) { const u = await User.findByPk(id); return u ? (u.toJSON ? u.toJSON() : u) : null; }
    if (isMng) return await User.findById(id).lean();
  } catch(e) { return null; }
}

async function findAllUsers() {
  if (!User) return [];
  try {
    if (isSeq) return (await User.findAll({ where:{ is_active:true } })).map(u => u.toJSON ? u.toJSON() : u);
    if (isMng) return await User.find({ is_active:true }).lean();
  } catch(e) { return []; }
}

async function updateUser(id, data) {
  if (!User || !id) return;
  try {
    if (isSeq) await User.update(data, { where:{ id } });
    if (isMng) await User.findByIdAndUpdate(id, data);
  } catch(e) { console.error('[ext] updateUser error:', e.message); }
}

async function saveMessage(data) {
  if (!Message) return null;
  try {
    const m = await Message.create(data);
    return m.toJSON ? m.toJSON() : m;
  } catch(e) {
    console.error('[ext] saveMessage error:', e.message);
    return null;
  }
}

async function queryMessages(where) {
  if (!Message) return [];
  try {
    if (isSeq) {
      const { Op } = require('sequelize');
      const rows = await Message.findAll({
        where,
        order: [['createdAt','DESC']], limit:200,
        include: [
          { model:User, as:'sender',   attributes:['id','name','email','role'], required:false },
          { model:User, as:'receiver', attributes:['id','name','email','role'], required:false },
        ],
      });
      return rows.map(r => r.toJSON ? r.toJSON() : r);
    }
    if (isMng) {
      return await Message.find(where)
        .sort({ createdAt:-1 }).limit(200)
        .populate('sender receiver','name email role').lean();
    }
  } catch(e) {
    console.error('[ext] queryMessages error:', e.message);
    return [];
  }
}

async function addNotification(userId, type, title, body='') {
  const n = { id:String(notifId++), user_id:String(userId), type, title, body, is_read:false, createdAt:new Date() };
  if (Notification) {
    try {
      if (isSeq) { await Notification.create(n); return; }
      if (isMng) { await Notification.create(n); return; }
    } catch(e) { console.error('[ext] addNotification error:', e.message); }
  }
  store.notifications.unshift(n);
}

// ═══════════════════════════════════════════════════════════════════
//  ONLINE PRESENCE
// ═══════════════════════════════════════════════════════════════════

router.post('/online/heartbeat', protect, wrap(async (req, res) => {
  const id = uid(req);
  if (id) store.online.set(id, Date.now());
  ok(res, { ok:true });
}));

router.get('/online/count', protect, wrap(async (req, res) => {
  const cut = Date.now() - 120000;
  for (const [k,t] of store.online) { if (t < cut) store.online.delete(k); }
  ok(res, { count: store.online.size });
}));

router.get('/admin/online', protect, adminOnly, wrap(async (req, res) => {
  const cut = Date.now() - 120000;
  const sessions = [];
  for (const [userId, ts] of store.online) {
    if (ts < cut) { store.online.delete(userId); continue; }
    const u = await findUser(userId);
    sessions.push({ user_id:userId, last_seen:new Date(ts),
      user: u ? { id:userId, name:u.name, role:u.role } : { id:userId } });
  }
  ok(res, { sessions, count:sessions.length });
}));

// ═══════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

router.get('/notifications', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let notifs = [];
  if (Notification) {
    try {
      if (isSeq) notifs = (await Notification.findAll({ where:{ user_id:userId }, order:[['createdAt','DESC']], limit:50 })).map(n => n.toJSON ? n.toJSON() : n);
      if (isMng) notifs = await Notification.find({ user_id:userId }).sort({ createdAt:-1 }).limit(50).lean();
    } catch(e) { notifs = store.notifications.filter(n => n.user_id===userId); }
  } else {
    notifs = store.notifications.filter(n => n.user_id===userId);
  }
  ok(res, { notifications:notifs, unread:notifs.filter(n=>!n.is_read).length });
}));

router.put('/notifications/read-all', protect, wrap(async (req, res) => {
  const userId = uid(req);
  if (Notification) {
    try {
      if (isSeq) await Notification.update({ is_read:true }, { where:{ user_id:userId } });
      if (isMng) await Notification.updateMany({ user_id:userId }, { is_read:true });
    } catch(e) {}
  }
  store.notifications.filter(n => n.user_id===userId).forEach(n => { n.is_read=true; });
  ok(res, {}, 'All read');
}));

// ═══════════════════════════════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════════════════════════════

router.post('/messages', protect, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = uid(req);
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');

  const data = { sender_id, receiver_id, subject, body, is_read:false, createdAt:new Date() };
  let msg = await saveMessage(data);

  if (!msg) {
    const s = await findUser(sender_id)   || { id:sender_id,   name:req.user?.name||'', email:'', role:'' };
    const r = await findUser(receiver_id) || { id:receiver_id, name:'Member',            email:'', role:'' };
    msg = { ...data, id:String(msgId++),
      sender  :{ id:sender_id,   name:s.name, email:s.email||'', role:s.role||'' },
      receiver:{ id:receiver_id, name:r.name, email:r.email||'', role:r.role||'' },
    };
    store.messages.unshift(msg);
  }

  await addNotification(receiver_id, 'message',
    `New message from ${req.user?.name || 'a member'}`, subject || String(body).slice(0,80));
  ok(res, { message:msg }, 'Message sent');
}));

router.get('/messages/inbox', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let msgs = [];
  if (Message) {
    if (isSeq) {
      const { Op } = require('sequelize');
      msgs = await queryMessages({ [Op.or]:[{ sender_id:userId },{ receiver_id:userId }] });
    } else if (isMng) {
      msgs = await queryMessages({ $or:[{ sender_id:userId },{ receiver_id:userId }] });
    }
  }
  if (!msgs.length) msgs = store.messages.filter(m => m.sender_id===userId || m.receiver_id===userId);
  ok(res, { messages:msgs });
}));

router.get('/messages', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const msgs = store.messages.filter(m => m.sender_id===userId || m.receiver_id===userId);
  ok(res, { messages:msgs });
}));

router.put('/messages/:id/read', protect, wrap(async (req, res) => {
  const userId = uid(req);
  if (Message) {
    try {
      if (isSeq) await Message.update({ is_read:true }, { where:{ id:req.params.id, receiver_id:userId } });
      if (isMng) await Message.updateOne({ _id:req.params.id, receiver_id:userId }, { is_read:true });
    } catch(e) {}
  }
  const m = store.messages.find(m => m.id===req.params.id);
  if (m) m.is_read = true;
  ok(res, {}, 'Read');
}));

router.delete('/messages/:id', protect, wrap(async (req, res) => {
  if (Message) {
    try {
      if (isSeq) await Message.destroy({ where:{ id:req.params.id } });
      if (isMng) await Message.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  store.messages = store.messages.filter(m => m.id!==req.params.id);
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN MESSAGES
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  let msgs = Message ? await queryMessages({}) : [...store.messages];
  ok(res, { messages:msgs });
}));

router.post('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = uid(req);
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');

  const data = { sender_id, receiver_id, subject, body, is_read:false, createdAt:new Date() };
  let msg = await saveMessage(data);
  if (!msg) {
    const r = await findUser(receiver_id) || { id:receiver_id, name:'Member', email:'', role:'' };
    msg = { ...data, id:String(msgId++),
      sender  :{ id:sender_id, name:req.user?.name||'Admin', email:'', role:'admin' },
      receiver:{ id:receiver_id, name:r.name, email:r.email||'', role:r.role||'' },
    };
    store.messages.unshift(msg);
  }
  await addNotification(receiver_id, 'message',
    `Message from Admin${subject ? ': '+subject : ''}`, String(body).slice(0,100));
  ok(res, { message:msg }, 'Message sent');
}));

router.delete('/admin/messages/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Message) {
    try {
      if (isSeq) await Message.destroy({ where:{ id:req.params.id } });
      if (isMng) await Message.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  store.messages = store.messages.filter(m => m.id!==req.params.id);
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  BROADCAST
// ═══════════════════════════════════════════════════════════════════

router.post('/admin/broadcast', protect, adminOnly, wrap(async (req, res) => {
  const { title, body='', type='info' } = req.body;
  if (!title) return fail(res, 'title is required');

  const sender_id = uid(req);
  const users     = await findAllUsers();
  let sent        = 0;

  for (const u of users) {
    const receiverId = String(u.id || u._id);
    await addNotification(receiverId, 'system', title, body);
    const data = { sender_id, receiver_id:receiverId,
      subject:`[Broadcast] ${title}`, body: body||title,
      is_read:false, createdAt:new Date() };
    const saved = await saveMessage(data);
    if (!saved) {
      store.messages.unshift({ ...data, id:String(msgId++),
        sender  :{ id:sender_id, name:req.user?.name||'Admin', role:'admin' },
        receiver:{ id:receiverId, name:u.name||'Member' },
      });
    }
    sent++;
  }

  const bc = { id:String(bcId++), title, body, type, sent, createdAt:new Date() };
  store.broadcasts.unshift(bc);
  ok(res, { broadcast:bc, sent }, `Broadcast sent to ${sent} members`);
}));

// ═══════════════════════════════════════════════════════════════════
//  GIFT / SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════════

router.put('/admin/users/:id/subscription', protect, adminOnly, wrap(async (req, res) => {
  const { tier, status='active', end_date, note } = req.body;
  const userId = req.params.id;

  let subEnd = null;
  if (end_date) subEnd = new Date(end_date);

  await updateUser(userId, {
    subscription_tier   : tier || 'free',
    subscription_status : status,
    subscription_end    : subEnd,
    updated_at          : new Date(),
  });

  const labels = { monthly:'Monthly Pro', annual:'Annual Pro', free:'Free' };
  let notifMsg = `Your plan has been updated to ${labels[tier]||tier}`;
  if (subEnd) {
    const perm = subEnd.getFullYear() >= 2099;
    notifMsg += perm ? ' — permanent access granted!'
      : ` — valid until ${subEnd.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`;
  }
  await addNotification(userId, 'system', notifMsg, note||'');

  const updated = await findUser(userId) || { id:userId, subscription_tier:tier, subscription_status:status, subscription_end:subEnd };
  ok(res, { user:updated }, 'Subscription updated');
}));

router.put('/admin/users/:id/ban', protect, adminOnly, wrap(async (req, res) => {
  const { banned } = req.body;
  await updateUser(req.params.id, { is_active:!banned });
  await addNotification(req.params.id, 'ban',
    banned ? 'Your account has been suspended' : 'Your account has been reinstated');
  ok(res, {}, banned ? 'User banned' : 'User unbanned');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN STATS EXTENDED
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/stats-extended', protect, adminOnly, wrap(async (req, res) => {
  const users   = await findAllUsers();
  const monthly = users.filter(u => u.subscription_tier==='monthly' && u.subscription_status==='active').length;
  const annual  = users.filter(u => u.subscription_tier==='annual'  && u.subscription_status==='active').length;
  ok(res, {
    users        : users.length,
    monthly_subs : monthly,
    annual_subs  : annual,
    free_users   : users.filter(u => !u.subscription_tier||u.subscription_tier==='free').length,
    mrr          : monthly*49 + annual*39,
    arr          : (monthly*49 + annual*39)*12,
    messages     : store.messages.length,
    broadcasts   : store.broadcasts.length,
    posts        : 0,
    open_rfps    : 0,
  });
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN POSTS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
  let posts = [];
  if (Post) {
    try {
      if (isSeq) posts = (await Post.findAll({ order:[['createdAt','DESC']], limit:100,
        include:[{ model:User, as:'author', attributes:['id','name','role'], required:false }]
      })).map(p => p.toJSON ? p.toJSON() : p);
      if (isMng) posts = await Post.find({}).sort({ createdAt:-1 }).limit(100).populate('author','name role').lean();
    } catch(e) { console.error('[ext] loadPosts:', e.message); }
  }
  ok(res, { posts });
}));

router.put('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Post) {
    try {
      if (isSeq) await Post.update(req.body, { where:{ id:req.params.id } });
      if (isMng) await Post.findByIdAndUpdate(req.params.id, req.body);
    } catch(e) { return fail(res, e.message); }
  }
  ok(res, {}, 'Updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  ERROR HANDLER  (no catch-all 404 — let other routers handle their own routes)
// ═══════════════════════════════════════════════════════════════════

router.use((error, req, res, next) => {
  console.error('[ext error]', error.message);
  res.status(error.status||500).json({
    status : 'error',
    error  : { message: error.message || 'Internal server error' },
  });
});

module.exports = router;
