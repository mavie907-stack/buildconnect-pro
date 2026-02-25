/**
 * BuildConnect Pro — src/routes/extension.js
 * ===========================================
 * Save as: src/routes/extension.js
 *
 * ⚠️  CRITICAL — server.js must register ext FIRST, before all other routes:
 *
 *   const ext = require('./routes/extension');
 *   app.use('/api/v1', ext);              // ← MUST BE FIRST
 *   app.use('/api/v1/auth', authRoutes);
 *   app.use('/api/v1/rfps', rfpRoutes);   // ← ext handles /rfps too; these won't conflict
 *   app.use('/api/v1/admin', adminRoutes);
 *
 * Routes handled by this file:
 *   Online   : POST /online/heartbeat  GET /online/count  GET /admin/online
 *   Notifs   : GET /notifications  PUT /notifications/read-all
 *   Messages : POST /messages  GET /messages/inbox  GET /messages  PUT /messages/:id/read  DELETE /messages/:id
 *   Msg Admin: GET /admin/messages  POST /admin/messages  DELETE /admin/messages/:id
 *   Broadcast: POST /admin/broadcast
 *   Subs     : PUT /admin/users/:id/subscription  PUT /admin/users/:id/ban
 *   Stats    : GET /admin/stats-extended
 *   Posts    : GET /admin/posts  PUT /admin/posts/:id
 *              GET /posts  POST /posts  POST /posts/:id/like  POST /posts/:id/comments
 *              DELETE /posts/:id
 *   RFPs     : GET /rfps  GET /rfps/my  GET /rfps/:id
 *              POST /rfps  POST /rfps/:id/publish  POST /rfps/:id/close
 *              POST /rfps/:id/proposals  GET /rfps/:id/proposals (admin)
 *   Members  : GET /members
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
  protect   = (req, res, next) => next();
  adminOnly = (req, res, next) => next();
}

// ─── Load models ───────────────────────────────────────────────────
let User, Message, Post, Notification, Rfp, Proposal;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { Rfp          = require('../models/Rfp');          } catch(e) {}
try { Proposal     = require('../models/Proposal');     } catch(e) {}

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
const store = {
  messages      : [],
  notifications : [],
  broadcasts    : [],
  posts         : [],
  rfps          : [],
  proposals     : [],
  online        : new Map(),
};
let msgId=1, notifId=1, bcId=1, postId=1, rfpId=1, propId=1;

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

  // Count open RFPs from DB or store
  let openRfps = 0;
  if (Rfp) {
    try {
      if (isSeq) openRfps = await Rfp.count({ where:{ status:'open' } });
      if (isMng) openRfps = await Rfp.countDocuments({ status:'open' });
    } catch(e) { openRfps = store.rfps.filter(r => r.status==='open').length; }
  } else {
    openRfps = store.rfps.filter(r => r.status==='open').length;
  }

  // Count posts from DB or store
  let totalPosts = 0;
  if (Post) {
    try {
      if (isSeq) totalPosts = await Post.count();
      if (isMng) totalPosts = await Post.countDocuments();
    } catch(e) { totalPosts = store.posts.length; }
  } else {
    totalPosts = store.posts.length;
  }

  ok(res, {
    users        : users.length,
    monthly_subs : monthly,
    annual_subs  : annual,
    free_users   : users.filter(u => !u.subscription_tier||u.subscription_tier==='free').length,
    mrr          : monthly*49 + annual*39,
    arr          : (monthly*49 + annual*39)*12,
    messages     : store.messages.length,
    broadcasts   : store.broadcasts.length,
    posts        : totalPosts,
    open_rfps    : openRfps,
  });
}));

// ═══════════════════════════════════════════════════════════════════
//  POSTS  (feed)
// ═══════════════════════════════════════════════════════════════════

// GET paginated feed
router.get('/posts', protect, wrap(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const skip  = (page - 1) * limit;
  let posts = [];

  if (Post) {
    try {
      if (isSeq) {
        posts = (await Post.findAll({
          order   : [['createdAt','DESC']],
          limit,
          offset  : skip,
          include : [{ model:User, as:'author', attributes:['id','name','email','role','company','subscription_tier'], required:false }],
        })).map(p => p.toJSON ? p.toJSON() : p);
      }
      if (isMng) {
        posts = await Post.find({})
          .sort({ createdAt:-1 }).skip(skip).limit(limit)
          .populate('author','name email role company subscription_tier').lean();
      }
    } catch(e) {
      console.error('[ext] loadPosts error:', e.message);
      posts = store.posts.slice(skip, skip + limit);
    }
  } else {
    posts = store.posts.slice(skip, skip + limit);
  }

  ok(res, { posts, page, limit });
}));

// POST create post
router.post('/posts', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { body, rfp_id, media } = req.body;
  if (!body) return fail(res, 'body is required');

  const data = {
    author_id  : userId,
    body,
    rfp_id     : rfp_id || null,
    media      : media  || [],
    likes      : [],
    comments   : [],
    is_pinned  : false,
    createdAt  : new Date(),
  };

  let post = null;
  if (Post) {
    try {
      const p = await Post.create(data);
      post = p.toJSON ? p.toJSON() : p;
      // Attach author info
      const author = await findUser(userId);
      if (author) post.author = { id:userId, name:author.name, email:author.email, role:author.role, company:author.company, subscription_tier:author.subscription_tier };
    } catch(e) { console.error('[ext] createPost error:', e.message); }
  }

  if (!post) {
    const author = await findUser(userId) || { id:userId, name:req.user?.name||'Member', role:req.user?.role||'professional' };
    post = { ...data, id:String(postId++), author:{ id:userId, name:author.name, email:author.email||'', role:author.role, company:author.company||'', subscription_tier:author.subscription_tier||'free' } };
    store.posts.unshift(post);
  }

  ok(res, { post }, 'Post created');
}));

// POST like / unlike
router.post('/posts/:id/like', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let post = null;

  if (Post) {
    try {
      if (isSeq) { const p = await Post.findByPk(req.params.id); post = p ? (p.toJSON ? p.toJSON() : p) : null; }
      if (isMng) post = await Post.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!post) post = store.posts.find(p => p.id===req.params.id);
  if (!post) return fail(res, 'Post not found', 404);

  const likes = Array.isArray(post.likes) ? post.likes.map(String) : [];
  const liked  = likes.includes(String(userId));
  const newLikes = liked ? likes.filter(id => id!==String(userId)) : [...likes, String(userId)];

  if (Post) {
    try {
      if (isSeq) await Post.update({ likes:newLikes }, { where:{ id:req.params.id } });
      if (isMng) await Post.findByIdAndUpdate(req.params.id, { likes:newLikes });
    } catch(e) {}
  }
  const sp = store.posts.find(p => p.id===req.params.id);
  if (sp) sp.likes = newLikes;

  ok(res, { liked:!liked, likes:newLikes }, liked ? 'Unliked' : 'Liked');
}));

// POST add comment
router.post('/posts/:id/comments', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { body } = req.body;
  if (!body) return fail(res, 'body is required');

  const author = await findUser(userId) || { id:userId, name:req.user?.name||'Member', role:req.user?.role||'' };
  const comment = { id:String(Date.now()), author:{ id:userId, name:author.name, role:author.role }, body, createdAt:new Date() };

  if (Post) {
    try {
      if (isSeq) {
        const p = await Post.findByPk(req.params.id);
        if (p) { const c = [...(p.comments||[]), comment]; await Post.update({ comments:c }, { where:{ id:req.params.id } }); }
      }
      if (isMng) await Post.findByIdAndUpdate(req.params.id, { $push:{ comments:comment } });
    } catch(e) {}
  }
  const sp = store.posts.find(p => p.id===req.params.id);
  if (sp) sp.comments = [...(sp.comments||[]), comment];

  ok(res, { comment }, 'Comment added');
}));

// DELETE post (owner or admin)
router.delete('/posts/:id', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let post = null;

  if (Post) {
    try {
      if (isSeq) { const p = await Post.findByPk(req.params.id); post = p ? (p.toJSON ? p.toJSON() : p) : null; }
      if (isMng) post = await Post.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!post) post = store.posts.find(p => p.id===req.params.id);
  if (!post) return fail(res, 'Post not found', 404);

  const isOwner = String(post.author_id) === String(userId);
  const isAdmin  = req.user?.role === 'admin';
  if (!isOwner && !isAdmin) return fail(res, 'Not authorised', 403);

  if (Post) {
    try {
      if (isSeq) await Post.destroy({ where:{ id:req.params.id } });
      if (isMng) await Post.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  store.posts = store.posts.filter(p => p.id!==req.params.id);
  ok(res, {}, 'Post deleted');
}));

// ─── Admin post management ─────────────────────────────────────────

router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
  let posts = [];
  if (Post) {
    try {
      if (isSeq) posts = (await Post.findAll({ order:[['createdAt','DESC']], limit:100,
        include:[{ model:User, as:'author', attributes:['id','name','role'], required:false }]
      })).map(p => p.toJSON ? p.toJSON() : p);
      if (isMng) posts = await Post.find({}).sort({ createdAt:-1 }).limit(100).populate('author','name role').lean();
    } catch(e) { console.error('[ext] loadPosts:', e.message); }
  } else {
    posts = [...store.posts];
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
  const sp = store.posts.find(p => p.id===req.params.id);
  if (sp) Object.assign(sp, req.body);
  ok(res, {}, 'Updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  RFPs
//  ⚠️  /rfps/my MUST be registered BEFORE /rfps/:id
//     otherwise Express will match "my" as the :id param
// ═══════════════════════════════════════════════════════════════════

// GET all open RFPs — for professionals browsing the marketplace
router.get('/rfps', protect, wrap(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;
  let rfps = [];

  if (Rfp) {
    try {
      if (isSeq) rfps = (await Rfp.findAll({
        where  : { status:'open' },
        order  : [['createdAt','DESC']],
        limit,
        offset : skip,
        include: [{ model:User, as:'client', attributes:['id','name','company','role'], required:false }],
      })).map(r => r.toJSON ? r.toJSON() : r);
      if (isMng) rfps = await Rfp.find({ status:'open' })
        .sort({ createdAt:-1 }).skip(skip).limit(limit)
        .populate('client_id','name company role').lean();
    } catch(e) { rfps = store.rfps.filter(r => r.status==='open').slice(skip, skip+limit); }
  } else {
    rfps = store.rfps.filter(r => r.status==='open').slice(skip, skip+limit);
  }

  ok(res, { rfps, page, limit });
}));

// GET my own RFPs — for clients (must come before /:id)
router.get('/rfps/my', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let rfps = [];

  if (Rfp) {
    try {
      if (isSeq) rfps = (await Rfp.findAll({
        where  : { client_id:userId },
        order  : [['createdAt','DESC']],
      })).map(r => r.toJSON ? r.toJSON() : r);
      if (isMng) rfps = await Rfp.find({ client_id:userId }).sort({ createdAt:-1 }).lean();
    } catch(e) { rfps = store.rfps.filter(r => r.client_id===userId); }
  } else {
    rfps = store.rfps.filter(r => r.client_id===userId);
  }

  ok(res, { rfps });
}));

// GET single RFP by ID
router.get('/rfps/:id', protect, wrap(async (req, res) => {
  let rfp = null;

  if (Rfp) {
    try {
      if (isSeq) {
        const r = await Rfp.findByPk(req.params.id, {
          include:[{ model:User, as:'client', attributes:['id','name','company','role'], required:false }],
        });
        rfp = r ? (r.toJSON ? r.toJSON() : r) : null;
      }
      if (isMng) rfp = await Rfp.findById(req.params.id).populate('client_id','name company role').lean();
    } catch(e) {}
  }

  if (!rfp) rfp = store.rfps.find(r => r.id===req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);

  // Increment view count (best-effort)
  if (Rfp) {
    try {
      if (isSeq) await Rfp.increment('view_count', { where:{ id:req.params.id } });
      if (isMng) await Rfp.findByIdAndUpdate(req.params.id, { $inc:{ view_count:1 } });
    } catch(e) {}
  } else {
    const sr = store.rfps.find(r => r.id===req.params.id);
    if (sr) sr.view_count = (sr.view_count||0)+1;
  }

  ok(res, { rfp });
}));

// POST create new RFP (clients only)
router.post('/rfps', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const {
    title, description, project_type, proposal_deadline,
    budget_min, budget_max, currency='USD',
    privacy_level='public', status='draft', location, industry,
  } = req.body;

  if (!title)             return fail(res, 'title is required');
  if (!description)       return fail(res, 'description is required');
  if (!project_type)      return fail(res, 'project_type is required');
  if (!proposal_deadline) return fail(res, 'proposal_deadline is required');

  const data = {
    client_id        : userId,
    title,
    description,
    project_type,
    proposal_deadline: new Date(proposal_deadline),
    budget_min       : budget_min  ? parseFloat(budget_min)  : null,
    budget_max       : budget_max  ? parseFloat(budget_max)  : null,
    currency,
    privacy_level,
    status,
    location         : location || null,
    industry         : industry || [],
    view_count       : 0,
    featured         : false,
    createdAt        : new Date(),
  };

  let rfp = null;
  if (Rfp) {
    try {
      const r = await Rfp.create(data);
      rfp = r.toJSON ? r.toJSON() : r;
    } catch(e) { console.error('[ext] createRfp error:', e.message); }
  }

  if (!rfp) {
    rfp = { ...data, id:String(rfpId++) };
    store.rfps.unshift(rfp);
  }

  ok(res, { rfp }, 'RFP created');
}));

// POST publish draft RFP → status:'open'
router.post('/rfps/:id/publish', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let rfp = null;

  if (Rfp) {
    try {
      if (isSeq) { const r = await Rfp.findByPk(req.params.id); rfp = r ? (r.toJSON ? r.toJSON() : r) : null; }
      if (isMng) rfp = await Rfp.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!rfp) rfp = store.rfps.find(r => r.id===req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);

  if (Rfp) {
    try {
      if (isSeq) await Rfp.update({ status:'open' }, { where:{ id:req.params.id } });
      if (isMng) await Rfp.findByIdAndUpdate(req.params.id, { status:'open' });
    } catch(e) {}
  }
  const sr = store.rfps.find(r => r.id===req.params.id);
  if (sr) sr.status = 'open';

  ok(res, {}, 'RFP published');
}));

// POST close / complete an RFP
router.post('/rfps/:id/close', protect, wrap(async (req, res) => {
  const userId = uid(req);
  let rfp = null;

  if (Rfp) {
    try {
      if (isSeq) { const r = await Rfp.findByPk(req.params.id); rfp = r ? (r.toJSON ? r.toJSON() : r) : null; }
      if (isMng) rfp = await Rfp.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!rfp) rfp = store.rfps.find(r => r.id===req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);

  if (Rfp) {
    try {
      if (isSeq) await Rfp.update({ status:'completed' }, { where:{ id:req.params.id } });
      if (isMng) await Rfp.findByIdAndUpdate(req.params.id, { status:'completed' });
    } catch(e) {}
  }
  const sr = store.rfps.find(r => r.id===req.params.id);
  if (sr) sr.status = 'completed';

  ok(res, {}, 'RFP closed');
}));

// POST submit BOQ / Proposal for an RFP
router.post('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const {
    cover_letter, proposed_budget, currency='USD',
    estimated_duration, start_date, relevant_experience,
    proposed_team, notes, boq_items, boq_total,
  } = req.body;

  if (!cover_letter)      return fail(res, 'cover_letter is required');
  if (!proposed_budget)   return fail(res, 'proposed_budget is required');
  if (!estimated_duration) return fail(res, 'estimated_duration is required');

  // Fetch the RFP to get client_id for notification
  let rfp = null;
  if (Rfp) {
    try {
      if (isSeq) { const r = await Rfp.findByPk(req.params.id); rfp = r ? (r.toJSON ? r.toJSON() : r) : null; }
      if (isMng) rfp = await Rfp.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!rfp) rfp = store.rfps.find(r => r.id===req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);

  const data = {
    rfp_id             : req.params.id,
    professional_id    : userId,
    cover_letter,
    proposed_budget    : parseFloat(proposed_budget),
    currency,
    estimated_duration,
    start_date         : start_date || null,
    relevant_experience: relevant_experience || '',
    proposed_team      : proposed_team || '',
    notes              : notes || '',
    boq_items          : boq_items  || [],
    boq_total          : boq_total  || 0,
    status             : 'submitted',
    submitted_at       : new Date(),
    createdAt          : new Date(),
  };

  let proposal = null;
  if (Proposal) {
    try {
      const p = await Proposal.create(data);
      proposal = p.toJSON ? p.toJSON() : p;
    } catch(e) { console.error('[ext] createProposal error:', e.message); }
  }
  if (!proposal) {
    proposal = { ...data, id:String(propId++) };
    store.proposals.unshift(proposal);
  }

  // Notify the client
  const clientId = String(rfp.client_id);
  const professional = await findUser(userId);
  const proName = professional?.name || req.user?.name || 'A professional';
  await addNotification(
    clientId, 'rfp',
    `New proposal received for: ${rfp.title}`,
    `${proName} submitted a proposal — Budget: ${currency} ${parseFloat(proposed_budget).toLocaleString()}`
  );

  ok(res, { proposal }, 'Proposal submitted successfully');
}));

// GET proposals for an RFP (client who owns it, or admin)
router.get('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const userId = uid(req);

  // Verify the requester is the RFP owner or admin
  let rfp = null;
  if (Rfp) {
    try {
      if (isSeq) { const r = await Rfp.findByPk(req.params.id); rfp = r ? (r.toJSON ? r.toJSON() : r) : null; }
      if (isMng) rfp = await Rfp.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!rfp) rfp = store.rfps.find(r => r.id===req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);

  let proposals = [];
  if (Proposal) {
    try {
      if (isSeq) proposals = (await Proposal.findAll({
        where  : { rfp_id:req.params.id },
        order  : [['createdAt','DESC']],
        include: [{ model:User, as:'professional', attributes:['id','name','company','role'], required:false }],
      })).map(p => p.toJSON ? p.toJSON() : p);
      if (isMng) proposals = await Proposal.find({ rfp_id:req.params.id })
        .sort({ createdAt:-1 })
        .populate('professional_id','name company role').lean();
    } catch(e) { proposals = store.proposals.filter(p => p.rfp_id===req.params.id); }
  } else {
    proposals = store.proposals.filter(p => p.rfp_id===req.params.id);
  }

  ok(res, { proposals });
}));

// ═══════════════════════════════════════════════════════════════════
//  MEMBERS DIRECTORY  (non-admin — returns public profile info)
// ═══════════════════════════════════════════════════════════════════

router.get('/members', protect, wrap(async (req, res) => {
  const q     = (req.query.q || '').toLowerCase();
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  let users   = await findAllUsers();

  if (q) {
    users = users.filter(u =>
      (u.name||'').toLowerCase().includes(q) ||
      (u.company||'').toLowerCase().includes(q) ||
      (u.role||'').toLowerCase().includes(q)
    );
  }

  // Return only safe public fields
  const members = users.slice(0, limit).map(u => ({
    id               : String(u.id || u._id),
    name             : u.name,
    company          : u.company  || '',
    role             : u.role     || '',
    location         : u.location || '',
    bio              : u.bio      || '',
    subscription_tier: u.subscription_tier || 'free',
    is_verified      : u.is_verified || false,
    createdAt        : u.createdAt,
  }));

  ok(res, { members, total:members.length });
}));

// ═══════════════════════════════════════════════════════════════════
//  ERROR HANDLER  (no catch-all 404 — let other routers handle theirs)
// ═══════════════════════════════════════════════════════════════════

router.use((error, req, res, next) => {
  console.error('[ext error]', error.message);
  res.status(error.status||500).json({
    status : 'error',
    error  : { message: error.message || 'Internal server error' },
  });
});

module.exports = router;
