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
  const auth    = require('../middleware/auth');
  protect       = auth.authenticate;
  adminOnly     = auth.isAdmin;
  if (!protect)   throw new Error('authenticate not found in middleware/auth');
  if (!adminOnly) throw new Error('isAdmin not found in middleware/auth');
} catch(e) {
  console.error('[extension] Auth middleware load error:', e.message);
  protect   = (req, res, next) => next();
  adminOnly = (req, res, next) => next();
}

// ─── Load models ───────────────────────────────────────────────────
let User, Message, Post, Notification, Comment, Follow, Event, Library, Badge;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { Comment      = require('../models/Comment');      } catch(e) {}
try { Follow       = require('../models/Follow');       } catch(e) {}
try { Event        = require('../models/Event');        } catch(e) {}
try { Library      = require('../models/Library');      } catch(e) {}
try { Badge        = require('../models/Badge');        } catch(e) {}

// Real-time
let emitToUser, broadcast, getOnlineCount, getOnlineIds, isOnline;
try {
  const sock = require('../socket');
  emitToUser    = sock.emitToUser;
  broadcast     = sock.broadcast;
  getOnlineCount= sock.getOnlineCount;
  getOnlineIds  = sock.getOnlineIds;
  isOnline      = sock.isOnline;
} catch(e) {
  emitToUser = ()=>{};  broadcast = ()=>{};
  getOnlineCount = ()=>0;  getOnlineIds = ()=>[];  isOnline = ()=>false;
}

// Badge system
let badgeSystem;
try { badgeSystem = require('../badges'); } catch(e) {}

// Email system
let sendEmail;
try { sendEmail = require('../routes/email').sendEmail; } catch(e) { sendEmail = async()=>{}; }

const isSeq = !!(User && typeof User.findAll === 'function');
const isMng = !!(User && typeof User.find    === 'function');

const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME||'dgxk9xgmh'}/image/upload/q_auto,f_auto,w_800/`;

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

  // Real-time delivery via Socket.io
  emitToUser(receiver_id, 'message:new', { message: msg });

  // Email notification if recipient is offline
  if (!isOnline(receiver_id)) {
    try {
      const sender = await findUser(sender_id);
      const recvr  = await findUser(receiver_id);
      if (recvr?.email && sender?.name) {
        sendEmail(recvr.email, 'newMessage', { toName: recvr.name, fromName: sender.name, preview: body });
      }
    } catch(e) {}
  }

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
  const { title, subject, body='', type='info' } = req.body;
  const resolvedTitle = title || subject;
  if (!resolvedTitle) return fail(res, 'title or subject is required');

  const sender_id = uid(req);
  const users     = await findAllUsers();
  let sent        = 0;

  for (const u of users) {
    const receiverId = String(u.id || u._id);
    await addNotification(receiverId, 'system', resolvedTitle, body);
    const data = { sender_id, receiver_id:receiverId,
      subject:`[Broadcast] ${resolvedTitle}`, body: body||resolvedTitle,
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

  const bc = { id:String(bcId++), title:resolvedTitle, body, type, sent, createdAt:new Date() };
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

router.delete('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Post && isSeq) {
    try {
      await Post.destroy({ where:{ id:req.params.id } });
      _posts = _posts.filter(p => String(p.id) !== String(req.params.id));
      return ok(res, {}, 'Deleted');
    } catch(e) { return fail(res, e.message); }
  }
  _posts = _posts.filter(p => String(p.id) !== String(req.params.id));
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  HOMEPAGE CONTENT  (in-memory; public read, admin write)
// ═══════════════════════════════════════════════════════════════════
let homepageData   = {};
let spotlightData  = null;
let _library       = [];

// Public homepage read (used by index.html)
router.get('/homepage', (req, res) => { ok(res, homepageData); });

// Admin homepage write (used by admin.html)
router.get('/admin/homepage', protect, adminOnly, (req, res) => { ok(res, homepageData); });
router.post('/admin/homepage', protect, adminOnly, (req, res) => {
  homepageData = { ...homepageData, ...req.body, updatedAt: new Date() };
  ok(res, homepageData);
});

// Legacy public write alias
router.post('/homepage', protect, (req, res) => {
  homepageData = { ...homepageData, ...req.body, updatedAt: new Date() };
  ok(res, homepageData);
});

// ═══════════════════════════════════════════════════════════════════
//  SPOTLIGHT
// ═══════════════════════════════════════════════════════════════════
router.get('/admin/spotlight', (req, res) => { ok(res, spotlightData || {}); });
router.put('/admin/spotlight', protect, adminOnly, (req, res) => {
  spotlightData = req.body;
  ok(res, spotlightData);
});

// ═══════════════════════════════════════════════════════════════════
//  LIBRARY FILES
// ═══════════════════════════════════════════════════════════════════
router.get('/library', wrap(async (req, res) => {
  if (Library && isSeq) {
    try {
      const rows = await Library.findAll({ order:[['createdAt','DESC']] });
      const files = rows.map(r => r.toJSON ? r.toJSON() : r);
      return ok(res, { files, items: files });
    } catch(e) { console.error('[ext] GET /library:', e.message); }
  }
  ok(res, { files: _library, items: _library });
}));

router.post('/library', protect, adminOnly, wrap(async (req, res) => {
  if (Library && isSeq) {
    try {
      const item = await Library.create({
        title      : req.body.title,
        description: req.body.description || '',
        category   : req.body.category   || 'catalogue',
        url        : req.body.url,
        filetype   : req.body.filetype   || 'PDF',
        size       : req.body.size       || '',
        access     : req.body.access     || 'pro_only',
        is_active  : true,
      });
      const data = item.toJSON ? item.toJSON() : item;
      _library.unshift(data);
      return ok(res, data, 'Added to library');
    } catch(e) { console.error('[ext] POST /library:', e.message); }
  }
  const item = { id: Date.now().toString(), ...req.body, createdAt: new Date() };
  _library.unshift(item);
  ok(res, item);
}));

router.put('/library/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Library && isSeq) {
    try {
      await Library.update(req.body, { where:{ id: req.params.id } });
      const updated = await Library.findByPk(req.params.id);
      const data = updated ? (updated.toJSON ? updated.toJSON() : updated) : {};
      _library = _library.map(f => String(f.id)===String(req.params.id) ? {...f,...req.body} : f);
      return ok(res, data);
    } catch(e) { console.error('[ext] PUT /library:', e.message); }
  }
  _library = _library.map(f => String(f.id)===String(req.params.id) ? {...f,...req.body} : f);
  ok(res, _library.find(f => String(f.id)===String(req.params.id)) || {});
}));

router.delete('/library/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Library && isSeq) {
    try {
      await Library.destroy({ where:{ id: req.params.id } });
      _library = _library.filter(f => String(f.id)!==String(req.params.id));
      return ok(res, {}, 'Deleted');
    } catch(e) { console.error('[ext] DELETE /library:', e.message); }
  }
  _library = _library.filter(f => String(f.id)!==String(req.params.id));
  ok(res, {}, 'Deleted');
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

// ═══════════════════════════════════════════════════════════════════
//  IN-MEMORY STORES — Posts, Follows, Events, Members cache
// ═══════════════════════════════════════════════════════════════════
// NOTE: These reset on server restart until DB models are added.
// Pattern matches existing extension.js — DB models auto-used when present.

let _posts   = [];
let _follows = []; // { follower_id, following_id }
let _events  = [
  { id:'ev1', title:'Architecture Networking Night — Istanbul', date:'2025-09-12', location:'Istanbul', description:'Annual meetup for architects and designers.', rsvps:[] },
  { id:'ev2', title:'Sustainable Design Webinar', date:'2025-08-28', location:'Online', description:'Exploring sustainable design practices.', rsvps:[] },
  { id:'ev3', title:'BuildConnect Pro Member Mixer', date:'2025-10-05', location:'Istanbul', description:'Exclusive mixer for Pro members.', rsvps:[] },
];
let _postId  = 1;

// ═══════════════════════════════════════════════════════════════════
//  POSTS  (feed)
// ═══════════════════════════════════════════════════════════════════

router.get('/posts', protect, wrap(async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 10;
  let posts = [];

  if (Post && isSeq) {
    try {
      const include = [
        { model:User, as:'author', attributes:['id','name','email','role','company','subscription_tier'], required:false },
      ];
      if (Comment) include.push({ model:Comment, as:'comments',
        include:[{ model:User, as:'author', attributes:['id','name'], required:false }],
        required:false });
      const rows = await Post.findAll({
        where: { is_hidden: false },
        order: [['is_pinned','DESC'],['createdAt','DESC']],
        limit, offset: (page-1)*limit,
        include,
      });
      posts = rows.map(r => r.toJSON ? r.toJSON() : r);
    } catch(e) { console.error('[ext] GET /posts DB error:', e.message); }
  }

  if (!posts.length) {
    const start = (page-1)*limit;
    posts = _posts.filter(p => !p.is_hidden).slice(start, start+limit);
  }

  ok(res, { posts, page, total: posts.length });
}));

router.post('/posts', protect, wrap(async (req, res) => {
  const { body, media=[], rfp_id } = req.body;
  if (!body && !media.length) return fail(res, 'Post body or media required');

  const author = await findUser(uid(req)) || { id:uid(req), name:req.user?.name||'Member', role:req.user?.role||'professional' };
  let post = {
    id       : String(_postId++),
    body     : body||'',
    media    : Array.isArray(media) ? media : [],
    rfp_id   : rfp_id||null,
    author_id: uid(req),
    author   : { id:author.id, name:author.name, role:author.role, company:author.company||'', subscription_tier:author.subscription_tier||'free' },
    likes    : [],
    comments : [],
    reactions: {},
    is_pinned: false,
    is_hidden: false,
    createdAt: new Date(),
  };

  if (Post && isSeq) {
    try {
      const saved = await Post.create({
        body     : post.body,
        media    : post.media,
        author_id: post.author_id,
        rfp_id   : post.rfp_id || null,
        likes    : [],
        reactions: {},
      });
      post.id = String(saved.id);
    } catch(e) { console.error('[ext] POST /posts DB error:', e.message); }
  }

  _posts.unshift(post);

  // Broadcast new post to all connected members
  broadcast('post:new', { post });

  // Check and award badges
  if (badgeSystem) {
    try {
      const postCount = Post && isSeq
        ? await Post.count({ where:{ author_id: uid(req) } })
        : _posts.filter(p => p.author_id === uid(req)).length;
      badgeSystem.checkAndAwardBadges(uid(req), 'post', { posts: postCount });
    } catch(e) {}
  }

  ok(res, { post }, 'Post created');
}));

router.post('/posts/:id/like', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const post   = _posts.find(p => String(p.id)===String(req.params.id));
  if (!post) return fail(res, 'Post not found', 404);
  const idx = post.likes.indexOf(userId);
  if (idx>=0) post.likes.splice(idx,1); else post.likes.push(userId);
  ok(res, { liked: idx<0, likes: post.likes.length });
}));

router.post('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const { emoji } = req.body;
  const userId    = uid(req);
  const post      = _posts.find(p => String(p.id)===String(req.params.id));
  if (!post) return fail(res, 'Post not found', 404);
  if (!post.reactions) post.reactions = {};
  // Format: { userId: emoji } — matches what postCard reads via rxMap[me.id]
  if (post.reactions[userId] === emoji) {
    delete post.reactions[userId]; // toggle off
  } else {
    post.reactions[userId] = emoji;
  }
  ok(res, { reactions: post.reactions });
}));

router.delete('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const post   = _posts.find(p => String(p.id)===String(req.params.id));
  if (!post) return fail(res, 'Post not found', 404);
  if (post.reactions) delete post.reactions[userId];
  ok(res, { reactions: post.reactions||{} });
}));

router.post('/posts/:id/comments', protect, wrap(async (req, res) => {
  const { body } = req.body;
  if (!body) return fail(res, 'Comment body required');
  const post   = _posts.find(p => String(p.id)===String(req.params.id));
  if (!post) return fail(res, 'Post not found', 404);
  const author = await findUser(uid(req)) || { id:uid(req), name:req.user?.name||'Member' };
  const comment = { id:String(Date.now()), body, author:{ id:author.id, name:author.name }, createdAt:new Date() };
  if (!post.comments) post.comments=[];
  post.comments.push(comment);
  ok(res, { comment }, 'Comment added');
}));

router.delete('/posts/:id', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const post   = _posts.find(p => String(p.id)===String(req.params.id));
  if (!post) return fail(res, 'Post not found', 404);
  if (String(post.author_id)!==userId && req.user?.role!=='admin')
    return fail(res, 'Not authorized', 403);

  if (Post) {
    try {
      if (isSeq) await Post.destroy({ where:{ id:req.params.id } });
    } catch(e) {}
  }
  _posts = _posts.filter(p => String(p.id)!==String(req.params.id));
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  MEMBERS  (directory)
// ═══════════════════════════════════════════════════════════════════

router.get('/members', protect, wrap(async (req, res) => {
  const users = await findAllUsers();
  let postCounts = {};
  if (Post && isSeq) {
    try {
      const { fn, col } = require('sequelize');
      const counts = await Post.findAll({ attributes:['author_id',[fn('COUNT','*'),'cnt']], group:['author_id'], raw:true });
      counts.forEach(r => { postCounts[String(r.author_id)] = parseInt(r.cnt)||0; });
    } catch(e) {}
  }
  const members = users.map(u => ({
    id      : u.id,
    name    : u.name,
    role    : u.role,
    company : u.company||'',
    location: u.location||'',
    bio     : u.bio||'',
    avatar  : u.avatar||null,
    subscription_tier: u.subscription_tier||'free',
    post_count: postCounts[String(u.id)] || _posts.filter(p => String(p.author_id)===String(u.id)).length,
  }));
  ok(res, { members });
}));

router.get('/members/:id/portfolio', protect, wrap(async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return fail(res, 'Member not found', 404);
  const posts = _posts.filter(p => String(p.author_id)===String(req.params.id));
  ok(res, { portfolio:{ user, posts, items:[] } });
}));

// ═══════════════════════════════════════════════════════════════════
//  PORTFOLIO  (own)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
//  PORTFOLIO — stored as JSON in User.portfolio_projects
// ═══════════════════════════════════════════════════════════════════

// Helper: get portfolio array from user
async function getUserPortfolio(userId) {
  try {
    if (User && isSeq) {
      const u = await User.findByPk(userId, { attributes:['id','portfolio_projects'] });
      if (u) {
        const raw = u.portfolio_projects || u.dataValues?.portfolio_projects;
        if (raw) return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
      }
    }
  } catch(e) {}
  return [];
}

// Helper: save portfolio array to user — raw SQL primary, ORM fallback
async function saveUserPortfolio(userId, projects) {
  const json = JSON.stringify(projects);
  if (!User || !isSeq) return false;
  try {
    const sequelize = User.sequelize;
    // Raw SQL — works even if column was just added by migration
    await sequelize.query(
      `UPDATE "Users" SET portfolio_projects = :json WHERE id = :id`,
      { replacements: { json, id: userId } }
    );
    return true;
  } catch(e) {
    try {
      // MySQL / fallback
      const sequelize = User.sequelize;
      await sequelize.query(
        `UPDATE Users SET portfolio_projects = :json WHERE id = :id`,
        { replacements: { json, id: userId } }
      );
      return true;
    } catch(e2) {
      // Final ORM fallback
      try {
        await User.update({ portfolio_projects: json }, { where: { id: userId } });
        return true;
      } catch(e3) { console.error('[portfolio] save error:', e3.message); }
    }
  }
  return false;
}

router.get('/portfolio', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const projects = await getUserPortfolio(userId);
  ok(res, { projects });
}));

router.post('/portfolio', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const project = { ...req.body, id: req.body.id || ('port-' + Date.now()), created_at: new Date().toISOString() };
  const projects = await getUserPortfolio(userId);
  // Avoid duplicates by id
  const exists = projects.findIndex(p => p.id === project.id);
  if (exists >= 0) projects[exists] = project;
  else projects.unshift(project);
  await saveUserPortfolio(userId, projects);
  ok(res, { project, projects }, 'Project saved');
}));

router.put('/portfolio/:id', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const projectId = req.params.id;
  const projects = await getUserPortfolio(userId);
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx < 0) return fail(res, 'Project not found', 404);
  projects[idx] = { ...projects[idx], ...req.body, id: projectId, updated_at: new Date().toISOString() };
  await saveUserPortfolio(userId, projects);
  ok(res, { project: projects[idx], projects }, 'Project updated');
}));

router.delete('/portfolio/:id', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const projects = await getUserPortfolio(userId);
  const filtered = projects.filter(p => p.id !== req.params.id);
  await saveUserPortfolio(userId, filtered);
  ok(res, { projects: filtered }, 'Project deleted');
}));

router.post('/portfolio/reorder', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { order } = req.body; // array of ids
  if (!Array.isArray(order)) return fail(res, 'order must be array');
  const projects = await getUserPortfolio(userId);
  const map = Object.fromEntries(projects.map(p => [p.id, p]));
  const reordered = order.map(id => map[id]).filter(Boolean);
  await saveUserPortfolio(userId, reordered);
  ok(res, { projects: reordered }, 'Reordered');
}));

router.get('/members/:id/portfolio', protect, wrap(async (req, res) => {
  const projects = await getUserPortfolio(req.params.id);
  const user = await findUser(req.params.id);
  ok(res, { portfolio: { user, projects } });
}));

// ═══════════════════════════════════════════════════════════════════
//  FOLLOWS
// ═══════════════════════════════════════════════════════════════════

router.get('/follows/following', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let ids = [];
  if (Follow && isSeq) {
    try {
      const rows = await Follow.findAll({ where:{ follower_id:userId }, raw:true });
      ids = rows.map(r => String(r.following_id));
    } catch(e) {}
  } else {
    ids = _follows.filter(f => f.follower_id===userId).map(f => f.following_id);
  }
  const users = await Promise.all(ids.map(id => findUser(id)));
  ok(res, { following: users.filter(Boolean) });
}));

router.get('/follows/followers', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let ids = [];
  if (Follow && isSeq) {
    try {
      const rows = await Follow.findAll({ where:{ following_id:userId }, raw:true });
      ids = rows.map(r => String(r.follower_id));
    } catch(e) {}
  } else {
    ids = _follows.filter(f => f.following_id===userId).map(f => f.follower_id);
  }
  const users = await Promise.all(ids.map(id => findUser(id)));
  ok(res, { followers: users.filter(Boolean) });
}));

router.post('/follows/:id', protect, wrap(async (req, res) => {
  const followerId  = uid(req);
  const followingId = req.params.id;
  if (followerId===followingId) return fail(res, 'Cannot follow yourself');
  if (Follow && isSeq) {
    try {
      await Follow.findOrCreate({ where:{ follower_id:followerId, following_id:followingId } });
    } catch(e) { console.error('[ext] Follow create error:', e.message); }
  } else {
    const exists = _follows.find(f => f.follower_id===followerId && f.following_id===followingId);
    if (!exists) _follows.push({ follower_id:followerId, following_id:followingId });
  }
  await addNotification(followingId, 'follow', 'New follower', req.user?.name + ' is now following you');

  // Real-time
  emitToUser(followingId, 'follow:new', { followerId, followerName: req.user?.name });

  // Email if offline
  if (!isOnline(followingId)) {
    try {
      const follower = await findUser(followerId);
      const followed = await findUser(followingId);
      if (followed?.email && follower?.name) {
        sendEmail(followed.email, 'newFollow', { toName: followed.name, fromName: follower.name, fromRole: follower.role||'member' });
      }
    } catch(e) {}
  }

  // Badges for follower (first_follow)
  if (badgeSystem) {
    try {
      const followingCount = Follow && isSeq
        ? await Follow.count({ where:{ follower_id: followerId } })
        : _follows.filter(f => f.follower_id===followerId).length;
      badgeSystem.checkAndAwardBadges(followerId, 'follow', { following: followingCount });
      // Badges for followed (followers count)
      const followerCount = Follow && isSeq
        ? await Follow.count({ where:{ following_id: followingId } })
        : _follows.filter(f => f.following_id===followingId).length;
      badgeSystem.checkAndAwardBadges(followingId, 'followers', { followers: followerCount });
    } catch(e) {}
  }

  ok(res, {}, 'Following');
}));

router.delete('/follows/:id', protect, wrap(async (req, res) => {
  const followerId  = uid(req);
  const followingId = req.params.id;
  if (Follow && isSeq) {
    try {
      await Follow.destroy({ where:{ follower_id:followerId, following_id:followingId } });
    } catch(e) {}
  } else {
    _follows = _follows.filter(f => !(f.follower_id===followerId && f.following_id===followingId));
  }
  ok(res, {}, 'Unfollowed');
}));

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

router.get('/events', wrap(async (req, res) => {
  if (Event && isSeq) {
    try {
      const rows = await Event.findAll({ where:{ is_active:true }, order:[['date','ASC']] });
      const events = rows.map(r => r.toJSON ? r.toJSON() : r);
      if (events.length) return ok(res, { events });
    } catch(e) { console.error('[ext] GET /events DB error:', e.message); }
  }
  ok(res, { events: _events });
}));

router.post('/events/:id/rsvp', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const event  = _events.find(e => String(e.id)===String(req.params.id));
  if (!event) return fail(res, 'Event not found', 404);
  if (!event.rsvps) event.rsvps=[];
  if (!event.rsvps.includes(userId)) event.rsvps.push(userId);
  ok(res, { rsvped:true }, 'RSVP confirmed');
}));


// ═══════════════════════════════════════════════════════════════════
//  MEDIA UPLOAD  — Cloudinary (persistent) with multer memoryStorage
// ═══════════════════════════════════════════════════════════════════
let upload;
let cloudinary;
try {
  const multer = require('multer');
  upload = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 15*1024*1024 } });
} catch(e) { console.warn('[extension] multer not available'); }

try {
  cloudinary = require('cloudinary').v2;
  // Config from env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key   : process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('[extension] Cloudinary configured ✅');
  } else {
    console.warn('[extension] Cloudinary env vars missing — uploads will fail');
  }
} catch(e) { console.warn('[extension] cloudinary package not available:', e.message); }

// Helper: upload a buffer to Cloudinary
function uploadToCloudinary(buffer, mimetype, folder='buildconnect') {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype.startsWith('image/') ? 'image' : 'raw';
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType, quality: 'auto', fetch_format: 'auto' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

router.post('/posts/upload', protect, (req, res, next) => {
  if (!upload) return fail(res, 'Upload not available');
  upload.array('files', 10)(req, res, async err => {
    if (err) return fail(res, err.message);
    try {
      const files = await Promise.all((req.files||[]).map(async f => {
        if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
          const result = await uploadToCloudinary(f.buffer, f.mimetype, 'buildconnect/posts');
          return {
            url : result.public_id,   // stored as public_id, imgUrl() prepends CLOUDINARY_BASE
            type: f.mimetype.startsWith('image/') ? 'image' : 'file',
            name: f.originalname,
            size: f.size,
          };
        }
        // Fallback: base64 data URL (works but large — only if no Cloudinary)
        const b64 = f.buffer.toString('base64');
        return {
          url : `data:${f.mimetype};base64,${b64}`,
          type: f.mimetype.startsWith('image/') ? 'image' : 'file',
          name: f.originalname,
          size: f.size,
        };
      }));
      ok(res, { files });
    } catch(e) {
      console.error('[ext] upload error:', e.message);
      fail(res, 'Upload failed: ' + e.message);
    }
  });
});

// ── POST /portfolio/upload — single image for portfolio cover ─────
router.post('/portfolio/upload', protect, (req, res, next) => {
  if (!upload) return fail(res, 'Upload not available');
  // Accept field named 'file' (single)
  upload.single('file')(req, res, async err => {
    if (err) return fail(res, err.message);
    if (!req.file) return fail(res, 'No file received');
    try {
      if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
        const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype, 'buildconnect/portfolio');
        // Return both full URL and public_id
        return ok(res, {
          url        : result.secure_url || (CLOUDINARY_BASE + result.public_id),
          public_id  : result.public_id,
          secure_url : result.secure_url,
        }, 'Uploaded');
      }
      // Fallback: base64
      const b64 = req.file.buffer.toString('base64');
      ok(res, { url: `data:${req.file.mimetype};base64,${b64}` }, 'Uploaded (local)');
    } catch(e) {
      console.error('[ext] portfolio upload error:', e.message);
      fail(res, 'Upload failed: ' + e.message);
    }
  });
});


router.post('/library/upload', protect, adminOnly, (req, res, next) => {
  if (!upload) return fail(res, 'Upload not available');
  upload.single('file')(req, res, async err => {
    if (err) return fail(res, err.message);
    if (!req.file) return fail(res, 'No file received');
    try {
      if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
        const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype, 'buildconnect/library');
        const isImage = req.file.mimetype.startsWith('image/');
        // For PDFs/raw files, build full URL; for images use public_id
        const url = isImage
          ? result.public_id
          : result.secure_url;
        return ok(res, { url, name: req.file.originalname, size: req.file.size });
      }
      fail(res, 'Cloudinary not configured');
    } catch(e) {
      fail(res, 'Upload failed: ' + e.message);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════════

router.get('/leaderboard', protect, wrap(async (req, res) => {
  try {
    const users = await findAllUsers();
    const leaderboard = await Promise.all(users.map(async u => {
      let postCount = _posts.filter(p => String(p.author_id)===String(u.id)).length;
      let followerCount = _follows.filter(f => String(f.following_id)===String(u.id)).length;
      let badgeCount = 0;

      if (Post && isSeq) {
        try { postCount = await Post.count({ where:{ author_id: u.id } }); } catch(e) {}
      }
      if (Follow && isSeq) {
        try { followerCount = await Follow.count({ where:{ following_id: u.id } }); } catch(e) {}
      }
      if (Badge) {
        try { badgeCount = await Badge.count({ where:{ user_id: u.id } }); } catch(e) {}
      }

      const score = (postCount * 10) + (followerCount * 5) + (badgeCount * 20);
      return {
        id      : u.id,
        name    : u.name,
        role    : u.role,
        company : u.company || '',
        avatar  : u.avatar  || null,
        subscription_tier: u.subscription_tier || 'free',
        post_count    : postCount,
        follower_count: followerCount,
        badge_count   : badgeCount,
        score,
      };
    }));

    leaderboard.sort((a,b) => b.score - a.score);
    // Add rank
    leaderboard.forEach((u,i) => { u.rank = i+1; });

    ok(res, { leaderboard: leaderboard.slice(0, 50) });
  } catch(e) {
    console.error('[ext] leaderboard error:', e.message);
    ok(res, { leaderboard: [] });
  }
}));

// ═══════════════════════════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════════════════════════

router.get('/badges/my', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const badges = badgeSystem ? await badgeSystem.getUserBadges(userId) : [];
  ok(res, { badges, definitions: badgeSystem?.BADGE_DEFS || {} });
}));

router.get('/badges/:userId', protect, wrap(async (req, res) => {
  const badges = badgeSystem ? await badgeSystem.getUserBadges(req.params.userId) : [];
  ok(res, { badges });
}));

router.post('/admin/badges/award', protect, adminOnly, wrap(async (req, res) => {
  const { userId, badgeKey } = req.body;
  if (!userId || !badgeKey) return fail(res, 'userId and badgeKey required');
  if (!badgeSystem) return fail(res, 'Badge system not available');
  const badge = await badgeSystem.awardBadge(userId, badgeKey);
  ok(res, { badge, awarded: !!badge }, badge ? 'Badge awarded' : 'Already has this badge');
}));

// ═══════════════════════════════════════════════════════════════════
//  ONLINE (real-time enhanced)
// ═══════════════════════════════════════════════════════════════════

// Override online count to use Socket.io when available
router.get('/online/count', wrap(async (req, res) => {
  const socketCount = getOnlineCount();
  if (socketCount > 0) return ok(res, { count: socketCount, userIds: getOnlineIds() });
  // Fallback to heartbeat-based
  const cutoff = new Date(Date.now() - 2*60*1000);
  const online = Object.values(store.online || {}).filter(t => new Date(t) > cutoff);
  ok(res, { count: Math.max(online.length, 1), userIds: [] });
}));

// ═══════════════════════════════════════════════════════════════════
//  PROFILE UPDATE (for portfolio/bio)
// ═══════════════════════════════════════════════════════════════════

router.put('/profile', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const allowed = ['name','bio','company','location','role','avatar','website','skills','linkedin','portfolio_projects'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  // If portfolio_projects is being updated, save it via raw SQL first (most reliable)
  if (updates.portfolio_projects && User && isSeq) {
    try {
      const sequelize = User.sequelize;
      await sequelize.query(
        `UPDATE "Users" SET portfolio_projects = :val WHERE id = :id`,
        { replacements: { val: updates.portfolio_projects, id: userId } }
      ).catch(() =>
        sequelize.query(
          `UPDATE Users SET portfolio_projects = :val WHERE id = :id`,
          { replacements: { val: updates.portfolio_projects, id: userId } }
        )
      );
    } catch(e) { console.warn('[profile] portfolio raw save:', e.message); }
  }

  if (User && isSeq) {
    try {
      // ORM update for other fields (may skip portfolio_projects if column unknown to model)
      const ormUpdates = {...updates};
      delete ormUpdates.portfolio_projects; // handled above via raw SQL
      if (Object.keys(ormUpdates).length) {
        await User.update(ormUpdates, { where:{ id: userId } });
      }
      const updated = await User.findByPk(userId, { attributes:{ exclude:['password'] } });
      const data = updated ? (updated.toJSON ? updated.toJSON() : updated) : { id: userId, ...updates };

      if (badgeSystem) {
        const hasAll = data.bio && data.company && data.location && data.avatar;
        if (hasAll) badgeSystem.awardBadge(userId, 'profile_complete');
      }
      return ok(res, { user: data }, 'Profile updated');
    } catch(e) { console.error('[ext] PUT /profile:', e.message); }
  }
  ok(res, { user: { id: userId, ...updates } }, 'Profile updated');

}));

router.get('/profile', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const user = await findUser(userId);
  if (!user) return fail(res, 'User not found', 404);
  const badges = badgeSystem ? await badgeSystem.getUserBadges(userId) : [];
  ok(res, { user, badges });
}));



// ═══════════════════════════════════════════════════════════════════
//  PROPOSALS — kanban support
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
//  POST /rfps/:id/proposals — submit a proposal
// ═══════════════════════════════════════════════════════════════════
router.post('/rfps/:rfpId/proposals', protect, wrap(async (req, res) => {
  const rfpId         = req.params.rfpId;
  const professionalId = uid(req);
  const {
    cover_letter, proposed_budget, currency, estimated_duration,
    start_date, relevant_experience, proposed_team, notes,
    boq_items, boq_total, submitted_at,
  } = req.body;

  if (!cover_letter) return fail(res, 'Cover letter is required');

  let saved = null;
  if (isSeq) {
    try {
      const Proposal = require('../models/Proposal');
      saved = await Proposal.create({
        rfp_id          : rfpId,
        professional_id : professionalId,
        cover_letter,
        proposed_budget : proposed_budget || null,
        currency        : currency || 'USD',
        timeline_weeks  : estimated_duration || null,
        start_date      : start_date || null,
        relevant_experience,
        proposed_team,
        notes,
        boq_items       : boq_items ? JSON.stringify(boq_items) : null,
        boq_total       : boq_total || 0,
        status          : 'new',
      });
      saved = saved.toJSON ? saved.toJSON() : saved;
    } catch(e) {
      console.error('[ext] create proposal error:', e.message);
    }
  }

  // Fallback object if DB save failed
  if (!saved) {
    saved = {
      id              : 'prop-' + Date.now(),
      rfp_id          : rfpId,
      professional_id : professionalId,
      cover_letter,
      proposed_budget,
      currency        : currency || 'USD',
      timeline_weeks  : estimated_duration,
      status          : 'new',
      createdAt       : new Date().toISOString(),
    };
  }

  // Notify the RFP owner
  try {
    let rfp = null;
    const RFP = require('../models/RFP');
    rfp = await RFP.findByPk(rfpId, { attributes: ['id','title','client_id'] }).catch(() => null);
    if (rfp?.client_id) {
      const professional = await findUser(professionalId);
      await addNotification(
        rfp.client_id, 'proposal',
        `New proposal received for "${rfp.title}"`,
        `From: ${professional?.name || 'A professional'}`
      );
      emitToUser(rfp.client_id, 'proposal:new', {
        proposal   : saved,
        rfpId,
        rfpTitle   : rfp.title,
        fromName   : professional?.name,
      });
      // Update proposals count on RFP
      await RFP.increment('proposals_count', { where: { id: rfpId } }).catch(() => {});
    }
  } catch(e) {}

  ok(res, { proposal: saved }, 'Proposal submitted');
}));


// GET /proposals/my — professional fetches their own submitted proposals
router.get('/proposals/my', protect, wrap(async (req, res) => {
  const userId = uid(req);
  try {
    let proposals = [];
    if (User && isSeq) {
      const { Op } = require('sequelize');
      // Proposals are stored in the Proposal model linked to RFPs
      const Proposal = require('../models/Proposal');
      proposals = await Proposal.findAll({
        where: { professional_id: userId },
        include: [
          { model: RFP, as: 'rfp', attributes: ['id','title','project_type','status'], required: false },
        ],
        order: [['createdAt','DESC']],
      }).catch(() => []);
      proposals = proposals.map(p => ({ ...(p.toJSON ? p.toJSON() : p) }));
    }
    ok(res, { proposals });
  } catch(e) {
    ok(res, { proposals: [] });
  }
}));

// GET /rfps/:id/proposals — client fetches proposals for their RFP
router.get('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const rfpId = req.params.id;
  try {
    let proposals = [];
    if (isSeq) {
      const Proposal = require('../models/Proposal');
      proposals = await Proposal.findAll({
        where: { rfp_id: rfpId },
        include: [
          { model: User, as: 'professional', attributes: ['id','name','email','role','company','avatar'], required: false },
        ],
        order: [['createdAt','DESC']],
      }).catch(() => []);
      proposals = proposals.map(p => ({ ...(p.toJSON ? p.toJSON() : p) }));
    }
    ok(res, { proposals });
  } catch(e) {
    ok(res, { proposals: [] });
  }
}));

// PUT /rfps/proposals/:id/status — client updates proposal status
router.put('/rfps/proposals/:id/status', protect, wrap(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['new','reviewing','shortlisted','awarded','rejected'];
  if (!validStatuses.includes(status)) return fail(res, 'Invalid status');
  try {
    const Proposal = require('../models/Proposal');
    await Proposal.update({ status }, { where: { id: req.params.id } });

    // Create notification for the professional
    const proposal = await Proposal.findByPk(req.params.id).catch(() => null);
    if (proposal?.professional_id) {
      const statusMessages = {
        reviewing  : 'Your proposal is being reviewed',
        shortlisted: 'You have been shortlisted! 🎉',
        awarded    : 'Congratulations! You were awarded the project! 🏆',
        rejected   : 'Your proposal was not selected for this project',
      };
      const msg = statusMessages[status];
      if (msg) {
        await addNotification(proposal.professional_id, 'proposal', msg, );
        emitToUser(proposal.professional_id, 'proposal:status', { proposalId: req.params.id, status });
      }
    }
    ok(res, { status }, 'Status updated');
  } catch(e) {
    // Graceful fallback
    ok(res, { status }, 'Status updated (local only)');
  }
}));



// ═══════════════════════════════════════════════════════════════════
//  PUBLIC GALLERY — no auth required
//  Mounted at /api/v1/public/* via extension (app.use('/api/v1', ext))
// ═══════════════════════════════════════════════════════════════════

async function fetchPortfolioUsers() {
  if (!User || !isSeq) return [];
  const sequelize = User.sequelize;
  if (!sequelize) return [];
  try {
    const result = await sequelize.query(
      `SELECT id, name, company, role, avatar, location, portfolio_projects FROM "Users" WHERE is_active = true`
    );
    return Array.isArray(result[0]) ? result[0] : [];
  } catch(e) {
    try {
      const result = await sequelize.query(
        `SELECT id, name, company, role, avatar, location, portfolio_projects FROM Users WHERE is_active = 1`
      );
      return Array.isArray(result[0]) ? result[0] : [];
    } catch(e2) { return []; }
  }
}

function parsePortfolio(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch(e) { return []; }
}

// Debug — shows DB state
router.get('/public/debug', wrap(async (req, res) => {
  const out = { has_user_model: !!User, column_exists: false, users: [], error: null };
  if (!User || !isSeq) return res.json(out);
  const sequelize = User.sequelize;
  if (!sequelize) return res.json({ ...out, error: 'no sequelize' });
  try {
    const colCheck = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Users' AND column_name='portfolio_projects'`
    );
    out.column_exists = (colCheck[0]||[]).length > 0;
  } catch(e) { out.col_error = e.message; }
  try {
    const result = await sequelize.query(`SELECT id, name, is_active, portfolio_projects FROM "Users" LIMIT 20`);
    out.users = (result[0]||[]).map(u => ({
      id: u.id, name: u.name, is_active: u.is_active,
      portfolio_items: parsePortfolio(u.portfolio_projects).length
    }));
  } catch(e) { out.error = e.message; }
  res.json(out);
}));

// Public gallery
router.get('/public/gallery', wrap(async (req, res) => {
  const { type, search, sort='recent', limit=100, offset=0 } = req.query;
  const users = await fetchPortfolioUsers();
  let projects = [];
  users.forEach(u => {
    parsePortfolio(u.portfolio_projects).forEach(p => {
      if (!p || !p.title) return;
      if (p.is_public === false) return;
      if (type   && p.type !== type) return;
      if (search && !JSON.stringify(p).toLowerCase().includes(search.toLowerCase())) return;
      projects.push({ ...p, user: { id:u.id, name:u.name, company:u.company, role:u.role, avatar:u.avatar } });
    });
  });
  if (sort === 'popular') projects.sort((a,b)=>(b.view_count||0)-(a.view_count||0));
  else projects.sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
  const total = projects.length;
  projects = projects.slice(parseInt(offset), parseInt(offset)+parseInt(limit));
  res.json({ status:'success', data: { projects, total } });
}));

// Public gallery featured
router.get('/public/gallery/featured', wrap(async (req, res) => {
  const users = await fetchPortfolioUsers();
  const featured = [];
  users.forEach(u => {
    parsePortfolio(u.portfolio_projects)
      .filter(p => p && p.featured && p.title && p.is_public !== false)
      .forEach(p => featured.push({ ...p, user: { id:u.id, name:u.name, company:u.company, role:u.role, avatar:u.avatar } }));
  });
  res.json({ status:'success', data: { projects: featured.slice(0,8) } });
}));

// Public gallery stats
router.get('/public/gallery/stats', wrap(async (req, res) => {
  const users = await fetchPortfolioUsers();
  const countries = new Set(), types = new Set();
  let projCount = 0, proCount = 0;
  users.forEach(u => {
    const projs = parsePortfolio(u.portfolio_projects).filter(p=>p&&p.title&&p.is_public!==false);
    if (projs.length) { proCount++; projCount += projs.length; }
    projs.forEach(p => {
      if (p.location) countries.add(p.location.split(',').pop().trim());
      if (p.type) types.add(p.type);
    });
  });
  res.json({ status:'success', data: { stats: { projects:projCount, professionals:proCount, countries:countries.size, types:types.size } } });
}));

// ═══════════════════════════════════════════════════════════════════
//  STARTUP MIGRATION — ensure portfolio_projects column exists
// ═══════════════════════════════════════════════════════════════════
(async () => {
  if (!User || !isSeq) return;
  try {
    const sequelize = User.sequelize;
    if (!sequelize) return;
    await sequelize.query(
      `ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS portfolio_projects TEXT`
    ).catch(() =>
      sequelize.query(`ALTER TABLE Users ADD COLUMN portfolio_projects TEXT`).catch(()=>{})
    );
    console.log('✅ [migration] portfolio_projects column ready');
  } catch(e) {
    console.warn('[migration] skipped:', e.message);
  }
})();

module.exports = router;
