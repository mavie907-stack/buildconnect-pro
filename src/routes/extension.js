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
const os      = require('os');

// ─── Optional dependencies ─────────────────────────────────────────
let Anthropic; try { Anthropic = require('@anthropic-ai/sdk'); } catch(e) {}

// ─── Cloudinary ────────────────────────────────────────────────────
let cloudinary;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name : process.env.CLOUDINARY_CLOUD_NAME || 'dgxk9xgmh',
    api_key    : process.env.CLOUDINARY_API_KEY    || '152912546379282',
    api_secret : process.env.CLOUDINARY_API_SECRET || 'Nvnb7AhYoHsI2ZK0N7Fbcg1oODU',
  });
} catch(e) { console.warn('[ext] Cloudinary not available'); }

// ─── Multer (disk storage → then upload to Cloudinary) ────────────
let multer, upload;
try {
  multer = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g,'_')),
  });
  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
} catch(e) { console.warn('[ext] Multer not available'); }

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
let User, Message, Post, Notification, RFP, Proposal, Portfolio;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { RFP          = require('../models/RFP');          } catch(e) {}
try { Proposal     = require('../models/Proposal');     } catch(e) {}
try { Portfolio    = require('../models/Portfolio');    } catch(e) {}

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
  online        : new Map(),
  follows       : [],   // { followerId, followedId, createdAt }
  reactions     : [],   // { postId, userId, emoji, createdAt }
  events        : [],   // event objects
  eventRsvps    : [],   // { eventId, userId }
  homepageData  : null, // persisted homepage config
};
let msgId=1, notifId=1, bcId=1, eventId=1;

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

// ═══════════════════════════════════════════════════════════════════
//  POSTS — feed, create, like, comment, delete, upload media
// ═══════════════════════════════════════════════════════════════════

router.get('/posts', protect, wrap(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;
  const posts = await Post.findAll({
    order: [['createdAt', 'DESC']],
    limit, offset,
    include: [{ model: User, as: 'author', attributes: ['id','name','company','role','subscription_tier'] }],
  });
  const formatted = posts.map(p => ({
    ...p.toJSON(),
    likes: p.likes || [],
    comments: p.comments || [],
  }));
  ok(res, { posts: formatted });
}));

router.post('/posts', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { body, media, rfp_id } = req.body;
  if (!body?.trim()) return fail(res, 'Post body required');
  const post = await Post.create({
    author_id : userId,
    body      : body.trim(),
    media     : media || [],
    rfp_id    : rfp_id || null,
    likes     : [],
    comments  : [],
  });
  const withAuthor = await Post.findByPk(post.id, {
    include: [{ model: User, as: 'author', attributes: ['id','name','company','role','subscription_tier'] }],
  });
  ok(res, { post: withAuthor }, 'Post created');
}));

router.post('/posts/upload', protect, wrap(async (req, res) => {
  if (!upload) return fail(res, 'File upload not configured');
  upload.array('files', 5)(req, res, async (err) => {
    if (err) return fail(res, err.message);
    if (!req.files?.length) return fail(res, 'No files uploaded');
    try {
      const files = await Promise.all(req.files.map(async file => {
        if (cloudinary) {
          const result = await cloudinary.uploader.upload(file.path, { folder: 'buildconnect/posts', resource_type: 'auto' });
          const fs = require('fs'); try { fs.unlinkSync(file.path); } catch(e) {}
          return { type: file.mimetype.startsWith('video') ? 'video' : 'image', url: result.secure_url, public_id: result.public_id };
        }
        return { type: 'image', url: `/uploads/${file.filename}` };
      }));
      ok(res, { files });
    } catch(e) { fail(res, e.message); }
  });
}));

router.post('/posts/:id/like', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const post = await Post.findByPk(req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  const likes = Array.isArray(post.likes) ? [...post.likes] : [];
  const idx = likes.indexOf(userId);
  if (idx === -1) likes.push(userId); else likes.splice(idx, 1);
  await post.update({ likes });
  ok(res, { likes, liked: idx === -1 });
}));

router.post('/posts/:id/comments', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { body } = req.body;
  if (!body?.trim()) return fail(res, 'Comment body required');
  const post = await Post.findByPk(req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  const user = await User.findByPk(userId, { attributes: ['id','name','role','company'] });
  const comment = { id: Date.now().toString(), author: user?.toJSON(), body: body.trim(), createdAt: new Date() };
  const comments = [...(post.comments || []), comment];
  await post.update({ comments });
  ok(res, { comment, comments });
}));

router.delete('/posts/:id', protect, wrap(async (req, res) => {
  const post = await Post.findByPk(req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  if (String(post.author_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await post.destroy();
  ok(res, {}, 'Post deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  RFPs — list, create, my rfps, publish, close, proposals
// ═══════════════════════════════════════════════════════════════════

router.get('/rfps', protect, wrap(async (req, res) => {
  const rfps = await RFP.findAll({
    where: { status: 'open' },
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'client', attributes: ['id','name','company'] }],
  });
  ok(res, { rfps: rfps.map(r => r.toJSON()) });
}));

router.get('/rfps/my', protect, wrap(async (req, res) => {
  const rfps = await RFP.findAll({
    where: { client_id: uid(req) },
    order: [['createdAt', 'DESC']],
  });
  ok(res, { rfps: rfps.map(r => r.toJSON()) });
}));

router.get('/rfps/:id', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id, {
    include: [{ model: User, as: 'client', attributes: ['id','name','company'] }],
  });
  if (!rfp) return fail(res, 'RFP not found', 404);
  await rfp.increment('view_count').catch(() => {});
  ok(res, { rfp: rfp.toJSON() });
}));

router.post('/rfps', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { title, description, project_type, proposal_deadline, budget_min, budget_max, currency, location, industry, privacy_level } = req.body;
  if (!title?.trim()) return fail(res, 'Title required');
  const rfp = await RFP.create({
    client_id       : userId,
    title           : title.trim(),
    description     : description || '',
    project_type    : project_type || '',
    proposal_deadline,
    budget_min      : budget_min || null,
    budget_max      : budget_max || null,
    currency        : currency || 'USD',
    location        : location || null,
    industry        : industry || [],
    privacy_level   : privacy_level || 'public',
    status          : 'draft',
    view_count      : 0,
  });
  ok(res, { rfp: rfp.toJSON() }, 'RFP created');
}));

router.post('/rfps/:id/publish', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await rfp.update({ status: 'open' });
  ok(res, { rfp: rfp.toJSON() }, 'RFP published');
}));

router.post('/rfps/:id/close', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await rfp.update({ status: 'closed' });
  ok(res, { rfp: rfp.toJSON() }, 'RFP closed');
}));

router.get('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  const proposals = await Proposal.findAll({
    where: { rfp_id: req.params.id },
    include: [{ model: User, as: 'professional', attributes: ['id','name','company','location'] }],
    order: [['createdAt', 'DESC']],
  });
  ok(res, { proposals: proposals.map(p => p.toJSON()) });
}));

router.post('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (rfp.status !== 'open') return fail(res, 'RFP is not open');
  const existing = await Proposal.findOne({ where: { rfp_id: req.params.id, professional_id: userId } });
  if (existing) return fail(res, 'You already submitted a proposal for this RFP');
  const { cover_letter, budget, timeline_days, attachments } = req.body;
  const proposal = await Proposal.create({
    rfp_id         : req.params.id,
    professional_id: userId,
    cover_letter   : cover_letter || '',
    budget         : budget || null,
    timeline_days  : timeline_days || null,
    attachments    : attachments || [],
    status         : 'pending',
  });
  await addNotification(String(rfp.client_id), 'proposal',
    `New proposal for: ${rfp.title}`,
    `A professional submitted a proposal for your RFP.`
  ).catch(() => {});
  ok(res, { proposal: proposal.toJSON() }, 'Proposal submitted');
}));

// ═══════════════════════════════════════════════════════════════════
//  PROFILE — update, avatar upload, members list
// ═══════════════════════════════════════════════════════════════════

router.put('/auth/me', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const allowed = ['name','company','location','bio','phone','website','specializations','languages'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  await User.update(updates, { where: { id: userId } });
  const updated = await User.findByPk(userId);
  ok(res, { user: updated.toPublicJSON ? updated.toPublicJSON() : updated.toJSON() }, 'Profile updated');
}));

router.put('/auth/updateMe', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const allowed = ['name','company','location','bio','phone','website','specializations','languages'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  await User.update(updates, { where: { id: userId } });
  const updated = await User.findByPk(userId);
  ok(res, { user: updated.toPublicJSON ? updated.toPublicJSON() : updated.toJSON() }, 'Profile updated');
}));

router.post('/auth/avatar', protect, wrap(async (req, res) => {
  if (!upload) return fail(res, 'Upload not configured');
  upload.single('avatar')(req, res, async (err) => {
    if (err) return fail(res, err.message);
    if (!req.file) return fail(res, 'No file uploaded');
    try {
      let url = `/uploads/${req.file.filename}`;
      if (cloudinary) {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: 'buildconnect/avatars', transformation: [{ width: 200, height: 200, crop: 'fill' }] });
        const fs = require('fs'); try { fs.unlinkSync(req.file.path); } catch(e) {}
        url = result.secure_url;
      }
      try { await User.update({ avatar: url }, { where: { id: uid(req) } }); } catch(e) { /* avatar column may not exist yet */ }
      ok(res, { url }, 'Avatar updated');
    } catch(e) { fail(res, e.message); }
  });
}));

router.get('/members', protect, wrap(async (req, res) => {
  let users = [];
  try {
    const { Op } = require('sequelize');
    users = await User.findAll({
      where: { role: { [Op.in]: ['professional', 'client', 'admin'] } },
      attributes: ['id','name','email','company','role','location','bio','subscription_tier','createdAt'],
      order: [['createdAt', 'DESC']],
    });
  } catch(e) {
    // Fallback: get all users without role filter
    try {
      users = await User.findAll({
        attributes: ['id','name','email','company','role','location','bio','subscription_tier','createdAt'],
        order: [['createdAt', 'DESC']],
      });
    } catch(e2) { return fail(res, 'Could not load members: ' + e2.message); }
  }
  ok(res, { members: users.map(u => u.toJSON ? u.toJSON() : u) });
}));

router.get('/members/:id', protect, wrap(async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: ['id','name','company','role','location','bio','subscription_tier','createdAt'],
  });
  if (!user) return fail(res, 'Member not found', 404);
  ok(res, { member: user.toJSON() });
}));


router.post('/online/heartbeat', protect, wrap(async (req, res) => {
  const id = uid(req);
  if (id) store.online.set(id, Date.now());
  ok(res, { ok:true });
}));

router.get('/online/count', protect, wrap(async (req, res) => {
  const cut = Date.now() - 120000;
  for (const [k,t] of store.online) { if (t < cut) store.online.delete(k); }
  // Also return basic user info for each online user (non-admin safe)
  const onlineUserIds = [...store.online.keys()];
  let onlineUsers = [];
  if (User && onlineUserIds.length) {
    try {
      const rows = await User.findAll({
        where: { id: onlineUserIds },
        attributes: ['id','name','role'],
      });
      onlineUsers = rows.map(u => u.toJSON ? u.toJSON() : u);
    } catch(e) {}
  }
  ok(res, { count: store.online.size, users: onlineUsers });
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


// ═══════════════════════════════════════════════════════════════════
//  AI PROJECT MATCHING
// ═══════════════════════════════════════════════════════════════════

function buildProfSummary(user, portfolio) {
  const parts = [];
  parts.push('Name: ' + user.name);
  parts.push('Company: ' + (user.company || 'Independent'));
  parts.push('Location: ' + (user.location || 'Not specified'));
  if (user.bio) parts.push('Bio: ' + user.bio);
  if (portfolio && portfolio.length) {
    parts.push('Portfolio (' + portfolio.length + ' projects):');
    portfolio.slice(0, 5).forEach(p => {
      parts.push('  - ' + p.title + ' | Type: ' + (p.project_type || 'N/A') + ' | Location: ' + (p.location || 'N/A'));
    });
  }
  return parts.join('\n');
}

function simpleFallbackMatch(rfp, professionals, portfolioMap) {
  const rfpLocation = ((rfp.location && rfp.location.country) || rfp.location || '').toString().toLowerCase();
  const rfpType = (rfp.project_type || (rfp.industry && rfp.industry[0]) || '').toLowerCase();
  return professionals.map(p => {
    let score = 50;
    const pData = p.toJSON ? p.toJSON() : p;
    const portfolio = portfolioMap[p.id] || [];
    const pLoc = (pData.location || '').toLowerCase();
    if (rfpLocation && pLoc) {
      if (pLoc.includes(rfpLocation.split(',')[0])) score += 25;
      else if (rfpLocation.includes(pLoc.split(',')[0])) score += 15;
    }
    if (rfpType) {
      const hits = portfolio.filter(proj => (proj.project_type || '').toLowerCase().includes(rfpType) || rfpType.includes((proj.project_type || '').toLowerCase()));
      score += Math.min(hits.length * 10, 20);
    }
    score += Math.min(portfolio.length * 2, 10);
    return {
      id: p.id,
      score: Math.min(score, 99),
      reason: (pData.company || pData.name) + ' has ' + portfolio.length + ' portfolio projects and is based in ' + (pData.location || 'N/A') + '.'
    };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}

router.get('/rfps/:id/matches', protect, wrap(async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) return fail(res, 'RFP not found', 404);

    const professionals = await User.findAll({
      where: { role: 'professional' },
      attributes: ['id', 'name', 'company', 'location', 'bio'],
    });

    if (!professionals.length) return ok(res, { matches: [] });

    let portfolioMap = {};
    try {
      const Portfolio = require('../models/Portfolio');
      const allPortfolios = await Portfolio.findAll({
        where: { user_id: professionals.map(p => p.id) },
      });
      allPortfolios.forEach(p => {
        if (!portfolioMap[p.user_id]) portfolioMap[p.user_id] = [];
        portfolioMap[p.user_id].push(p.toJSON ? p.toJSON() : p);
      });
    } catch(e) {}

    const rfpData = rfp.toJSON ? rfp.toJSON() : rfp;
    let matches = [];

    if (Anthropic && process.env.ANTHROPIC_API_KEY) {
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const profsText = professionals.map((p, i) => '[PROF ' + (i+1) + '] ID: ' + p.id + '\n' + buildProfSummary(p.toJSON ? p.toJSON() : p, portfolioMap[p.id] || [])).join('\n---\n');
        const prompt = 'Find the TOP 5 best matching professionals for this RFP.\n\nRFP: ' + rfpData.title + '\nType: ' + (rfpData.project_type || 'N/A') + '\nLocation: ' + (rfpData.location || 'N/A') + '\nDescription: ' + (rfpData.description || '').slice(0, 200) + '\n\nPROFESSIONALS:\n' + profsText + '\n\nRespond ONLY with valid JSON: {"matches":[{"id":"uuid","score":95,"reason":"one sentence"}]}';
        const response = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
        const text = (response.content[0] && response.content[0].text) || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        matches = parsed.matches || [];
      } catch(e) {
        console.error('[AI Match]', e.message);
        matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
      }
    } else {
      matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
    }

    const enriched = matches.slice(0, 5).map(m => {
      const user = professionals.find(p => String(p.id) === String(m.id));
      if (!user) return null;
      const u = user.toJSON ? user.toJSON() : user;
      return { id: m.id, name: u.name, company: u.company || 'Independent', location: u.location || '', portfolio_count: (portfolioMap[m.id] || []).length, score: m.score, reason: m.reason };
    }).filter(Boolean);

    ok(res, { matches: enriched });
  } catch(e) {
    console.error('[matches route]', e.message);
    fail(res, 'Could not load matches: ' + e.message, 500);
  }
}));

router.post('/rfps/:id/matches/notify', protect, wrap(async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) return fail(res, 'RFP not found', 404);
    const { matches } = req.body;
    if (!matches || !matches.length) return fail(res, 'No matches provided');
    let notified = 0;
    for (const m of matches) {
      try {
        await addNotification(m.id, 'match', '🎯 New Project Match: ' + (rfp.title || ''), 'You matched a new project! ' + (m.reason || ''));
        notified++;
      } catch(e) {}
    }
    ok(res, { notified }, 'Notified ' + notified + ' professionals');
  } catch(e) {
    fail(res, e.message, 500);
  }
}));


// ═══════════════════════════════════════════════════════════════════
//  ADMIN — users, stats, projects (RFPs), library
// ═══════════════════════════════════════════════════════════════════

// GET /admin/users
router.get('/admin/users', protect, adminOnly, wrap(async (req, res) => {
  const users = await User.findAll({ order: [['createdAt','DESC']] });
  ok(res, { users: users.map(u => u.toJSON ? u.toJSON() : u) });
}));

// GET /admin/users/:id
router.get('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return fail(res, 'User not found', 404);
  ok(res, { user: user.toJSON ? user.toJSON() : user });
}));

// PUT /admin/users/:id
router.put('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  const allowed = ['name','company','location','role','is_active','subscription_tier','bio','email'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  await User.update(updates, { where: { id: req.params.id } });
  const updated = await User.findByPk(req.params.id);
  ok(res, { user: updated.toJSON ? updated.toJSON() : updated }, 'User updated');
}));

// DELETE /admin/users/:id
router.delete('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  await User.destroy({ where: { id: req.params.id } });
  ok(res, {}, 'User deleted');
}));

// GET /admin/stats
router.get('/admin/stats', protect, adminOnly, wrap(async (req, res) => {
  const [totalUsers, totalRfps, totalPosts, totalMessages] = await Promise.all([
    User.count().catch(() => 0),
    RFP ? RFP.count().catch(() => 0) : Promise.resolve(0),
    Post ? Post.count().catch(() => 0) : Promise.resolve(0),
    Message ? Message.count().catch(() => 0) : Promise.resolve(0),
  ]);
  const professionals = await User.count({ where: { role: 'professional' } }).catch(() => 0);
  const clients       = await User.count({ where: { role: 'client'       } }).catch(() => 0);
  const openRfps      = RFP ? await RFP.count({ where: { status: 'open' } }).catch(() => 0) : 0;
  ok(res, { stats: { totalUsers, professionals, clients, totalRfps, openRfps, totalPosts, totalMessages } });
}));

// GET /admin/projects  (RFPs for admin view)
router.get('/admin/projects', protect, adminOnly, wrap(async (req, res) => {
  if (!RFP) return ok(res, { projects: [] });
  const rfps = await RFP.findAll({
    order: [['createdAt','DESC']],
    include: [{ model: User, as: 'client', attributes: ['id','name','company'], required: false }],
  });
  ok(res, { projects: rfps.map(r => r.toJSON ? r.toJSON() : r) });
}));

// PUT /admin/projects/:id/status
router.put('/admin/projects/:id/status', protect, adminOnly, wrap(async (req, res) => {
  if (!RFP) return fail(res, 'RFP model not available');
  const { status } = req.body;
  await RFP.update({ status }, { where: { id: req.params.id } });
  ok(res, {}, 'Status updated');
}));

// PUT /admin/projects/:id  (generic update — featured, status etc)
router.put('/admin/projects/:id', protect, adminOnly, wrap(async (req, res) => {
  if (!RFP) return fail(res, 'RFP model not available');
  const allowed = ['status','featured','title','description'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  await RFP.update(updates, { where: { id: req.params.id } });
  ok(res, {}, 'Project updated');
}));

// DELETE /admin/projects/:id
router.delete('/admin/projects/:id', protect, adminOnly, wrap(async (req, res) => {
  if (!RFP) return fail(res, 'RFP model not available');
  await RFP.destroy({ where: { id: req.params.id } });
  ok(res, {}, 'Project deleted');
}));

// GET /admin/library
router.get('/admin/library', protect, adminOnly, wrap(async (req, res) => {
  let LibraryFile;
  try { LibraryFile = require('../models/LibraryFile'); } catch(e) {}
  if (!LibraryFile) return ok(res, { files: [] });
  const files = await LibraryFile.findAll({ order: [['createdAt','DESC']] });
  ok(res, { files: files.map(f => f.toJSON ? f.toJSON() : f) });
}));

// DELETE /admin/library/:id
router.delete('/admin/library/:id', protect, adminOnly, wrap(async (req, res) => {
  let LibraryFile;
  try { LibraryFile = require('../models/LibraryFile'); } catch(e) {}
  if (!LibraryFile) return fail(res, 'Library not available');
  await LibraryFile.destroy({ where: { id: req.params.id } });
  ok(res, {}, 'File deleted');
}));

// GET /library (public library for members)
router.get('/library', protect, wrap(async (req, res) => {
  let LibraryFile;
  try { LibraryFile = require('../models/LibraryFile'); } catch(e) {}
  if (!LibraryFile) return ok(res, { files: [] });
  const files = await LibraryFile.findAll({ order: [['createdAt','DESC']] });
  ok(res, { files: files.map(f => f.toJSON ? f.toJSON() : f) });
}));



// ═══════════════════════════════════════════════════════════════
//  HOMEPAGE CONTENT MANAGER  (GET/POST /admin/homepage)
// ═══════════════════════════════════════════════════════════════
//
// Stores:  { showcaseImages[], howImages[], featuredProjects[],
//            tickerItems[], sponsors[], adBanner{} }
// Attempts to persist to DB via a Settings model if available;
// falls back to in-memory store so it always works.

let HomepageSetting; // optional Settings/Config model
try { HomepageSetting = require('../models/Setting'); } catch(e) {}
try { if (!HomepageSetting) HomepageSetting = require('../models/Config'); } catch(e) {}
try { if (!HomepageSetting) HomepageSetting = require('../models/SiteConfig'); } catch(e) {}

const HP_KEY = 'homepage_data';

async function loadHomepage() {
  // Try DB first
  if (HomepageSetting) {
    try {
      let row;
      if (isSeq) row = await HomepageSetting.findOne({ where:{ key: HP_KEY } });
      else if (isMng) row = await HomepageSetting.findOne({ key: HP_KEY }).lean();
      if (row) {
        const val = row.value || row.data || row.json;
        return typeof val === 'string' ? JSON.parse(val) : val;
      }
    } catch(e) {}
  }
  // Fall back to in-memory
  return store.homepageData || {
    showcaseImages  : [],
    howImages       : [],
    featuredProjects: [],
    tickerItems     : [],
    sponsors        : [],
    adBanner        : {}
  };
}

async function saveHomepage(data) {
  store.homepageData = data;
  if (HomepageSetting) {
    try {
      const val = JSON.stringify(data);
      if (isSeq) {
        const [row, created] = await HomepageSetting.findOrCreate({
          where  : { key: HP_KEY },
          defaults: { key: HP_KEY, value: val }
        });
        if (!created) await row.update({ value: val });
      } else if (isMng) {
        await HomepageSetting.findOneAndUpdate(
          { key: HP_KEY },
          { key: HP_KEY, value: val, data },
          { upsert: true, new: true }
        );
      }
    } catch(e) { console.warn('[ext] Could not persist homepage data:', e.message); }
  }
}

router.get('/admin/homepage', protect, wrap(async (req, res) => {
  const data = await loadHomepage();
  ok(res, data);
}));

router.post('/admin/homepage', protect, adminOnly, wrap(async (req, res) => {
  const current = await loadHomepage();
  const merged  = { ...current, ...req.body };
  await saveHomepage(merged);
  ok(res, merged, 'Homepage data saved');
}));

// Also expose publicly for the homepage to fetch (no auth needed)
router.get('/homepage', wrap(async (req, res) => {
  const data = await loadHomepage();
  ok(res, data);
}));


// ═══════════════════════════════════════════════════════════════
//  FOLLOW SYSTEM  (/follows)
// ═══════════════════════════════════════════════════════════════

let Follow; // optional Follow model
try { Follow = require('../models/Follow'); } catch(e) {}

async function getFollows(where) {
  if (Follow) {
    try {
      if (isSeq) return (await Follow.findAll({ where, include:[{ model: User, as:'followed', attributes:['id','name','role','company'] }] })).map(f => f.toJSON ? f.toJSON() : f);
      if (isMng) return await Follow.find(where).populate('followed', 'id name role company').lean();
    } catch(e) {}
  }
  // in-memory
  return store.follows.filter(f =>
    Object.entries(where).every(([k,v]) => String(f[k]) === String(v))
  );
}

// GET /follows/following  — who I follow
router.get('/follows/following', protect, wrap(async (req, res) => {
  const me = uid(req);
  const rows = await getFollows({ followerId: me });
  const users = rows.map(r => r.followed || { id: r.followedId, name: '—' });
  ok(res, users);
}));

// GET /follows/followers  — who follows me
router.get('/follows/followers', protect, wrap(async (req, res) => {
  const me = uid(req);
  const rows = await getFollows({ followedId: me });
  const users = rows.map(r => r.follower || { id: r.followerId, name: '—' });
  ok(res, users);
}));

// POST /follows/:userId  — follow someone
router.post('/follows/:userId', protect, wrap(async (req, res) => {
  const me = uid(req);
  const followedId = req.params.userId;
  if (me === followedId) return fail(res, 'Cannot follow yourself');

  // Check already following
  const existing = await getFollows({ followerId: me, followedId });
  if (existing.length) return ok(res, {}, 'Already following');

  if (Follow) {
    try {
      if (isSeq) await Follow.create({ followerId: me, followedId });
      if (isMng) await Follow.create({ followerId: me, followedId });
    } catch(e) {
      store.follows.push({ followerId: me, followedId, createdAt: new Date() });
    }
  } else {
    store.follows.push({ followerId: me, followedId, createdAt: new Date() });
  }

  // Notify the followed user
  const follower = await findUser(me);
  await saveNotif({
    user_id    : followedId,
    type       : 'follow',
    title      : 'New Follower',
    body       : `${follower?.name || 'Someone'} started following you`,
    sender_id  : me,
  });

  ok(res, {}, 'Now following');
}));

// DELETE /follows/:userId  — unfollow
router.delete('/follows/:userId', protect, wrap(async (req, res) => {
  const me = uid(req);
  const followedId = req.params.userId;

  if (Follow) {
    try {
      if (isSeq) await Follow.destroy({ where:{ followerId: me, followedId } });
      if (isMng) await Follow.deleteOne({ followerId: me, followedId });
    } catch(e) {}
  }
  store.follows = store.follows.filter(f => !(String(f.followerId)===me && String(f.followedId)===followedId));
  ok(res, {}, 'Unfollowed');
}));


// ═══════════════════════════════════════════════════════════════
//  REACTIONS  (/posts/:id/reactions)
// ═══════════════════════════════════════════════════════════════

// POST /posts/:id/reactions  { emoji }
router.post('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const me     = uid(req);
  const postId = req.params.id;
  const emoji  = req.body.emoji || '❤️';

  // Remove existing reaction from this user on this post
  store.reactions = store.reactions.filter(r => !(String(r.postId)===postId && r.userId===me));
  store.reactions.push({ postId, userId: me, emoji, createdAt: new Date() });

  // Try to persist via Post model
  if (Post) {
    try {
      if (isSeq) {
        const post = await Post.findByPk(postId);
        if (post) {
          const rx = post.reactions || {};
          rx[me] = emoji;
          await post.update({ reactions: rx });
        }
      } else if (isMng) {
        await Post.findByIdAndUpdate(postId, { [`reactions.${me}`]: emoji });
      }
    } catch(e) {}
  }

  ok(res, { emoji }, 'Reaction saved');
}));

// DELETE /posts/:id/reactions  — remove my reaction
router.delete('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const me     = uid(req);
  const postId = req.params.id;

  store.reactions = store.reactions.filter(r => !(String(r.postId)===postId && r.userId===me));

  if (Post) {
    try {
      if (isSeq) {
        const post = await Post.findByPk(postId);
        if (post) {
          const rx = post.reactions || {};
          delete rx[me];
          await post.update({ reactions: rx });
        }
      } else if (isMng) {
        await Post.findByIdAndUpdate(postId, { $unset:{ [`reactions.${me}`]: '' } });
      }
    } catch(e) {}
  }

  ok(res, {}, 'Reaction removed');
}));


// ═══════════════════════════════════════════════════════════════
//  EVENTS  (/events)
// ═══════════════════════════════════════════════════════════════

let Event; // optional Event model
try { Event = require('../models/Event'); } catch(e) {}

async function getEvents(filter = {}) {
  if (Event) {
    try {
      if (isSeq) return (await Event.findAll({ order:[['date','ASC']] })).map(e => e.toJSON ? e.toJSON() : e);
      if (isMng) return await Event.find(filter).sort({ date:1 }).lean();
    } catch(e) {}
  }
  return store.events;
}

async function saveEvent(data) {
  if (Event) {
    try {
      if (isSeq) { const e = await Event.create(data); return e.toJSON ? e.toJSON() : e; }
      if (isMng) { const e = await Event.create(data); return e.toJSON ? e.toJSON() : e; }
    } catch(e) {}
  }
  const ev = { id: String(eventId++), ...data, createdAt: new Date() };
  store.events.push(ev);
  return ev;
}

// GET /events  (public — no auth needed for members to browse)
router.get('/events', protect, wrap(async (req, res) => {
  const events = await getEvents();
  ok(res, { events });
}));

// GET /events/:id
router.get('/events/:id', protect, wrap(async (req, res) => {
  const events = await getEvents();
  const ev = events.find(e => String(e.id) === req.params.id);
  if (!ev) return fail(res, 'Event not found', 404);
  ok(res, ev);
}));

// POST /events  (admin only)
router.post('/events', protect, adminOnly, wrap(async (req, res) => {
  const ev = await saveEvent({ ...req.body, attendees_count: 0 });
  ok(res, ev, 'Event created');
}));

// PUT /events/:id  (admin only)
router.put('/events/:id', protect, adminOnly, wrap(async (req, res) => {
  const id = req.params.id;
  if (Event) {
    try {
      if (isSeq) { await Event.update(req.body, { where:{ id } }); }
      if (isMng) { await Event.findByIdAndUpdate(id, req.body); }
    } catch(e) {}
  } else {
    const idx = store.events.findIndex(e => String(e.id) === id);
    if (idx > -1) store.events[idx] = { ...store.events[idx], ...req.body };
  }
  ok(res, {}, 'Event updated');
}));

// DELETE /events/:id  (admin only)
router.delete('/events/:id', protect, adminOnly, wrap(async (req, res) => {
  const id = req.params.id;
  if (Event) {
    try {
      if (isSeq) await Event.destroy({ where:{ id } });
      if (isMng) await Event.findByIdAndDelete(id);
    } catch(e) {}
  }
  store.events = store.events.filter(e => String(e.id) !== id);
  store.eventRsvps = store.eventRsvps.filter(r => String(r.eventId) !== id);
  ok(res, {}, 'Event deleted');
}));

// POST /events/:id/rsvp
router.post('/events/:id/rsvp', protect, wrap(async (req, res) => {
  const me      = uid(req);
  const eventId = req.params.id;

  // Idempotent
  const already = store.eventRsvps.find(r => String(r.eventId)===eventId && r.userId===me);
  if (already) return ok(res, {}, 'Already RSVPd');

  store.eventRsvps.push({ eventId, userId: me, createdAt: new Date() });

  // Increment attendee count
  if (Event) {
    try {
      if (isSeq) {
        const ev = await Event.findByPk(eventId);
        if (ev) await ev.increment('attendees_count');
      } else if (isMng) {
        await Event.findByIdAndUpdate(eventId, { $inc:{ attendees_count:1 } });
      }
    } catch(e) {}
  } else {
    const ev = store.events.find(e => String(e.id) === eventId);
    if (ev) ev.attendees_count = (ev.attendees_count || 0) + 1;
  }

  ok(res, {}, 'RSVP confirmed');
}));

// GET /events/:id/rsvps  (admin)
router.get('/events/:id/rsvps', protect, adminOnly, wrap(async (req, res) => {
  const rsvps = store.eventRsvps.filter(r => String(r.eventId) === req.params.id);
  ok(res, { rsvps, count: rsvps.length });
}));


// ═══════════════════════════════════════════════════════════════
//  MEMBER PORTFOLIO  (/members/:id/portfolio)
// ═══════════════════════════════════════════════════════════════

router.get('/members/:id/portfolio', protect, wrap(async (req, res) => {
  const userId = req.params.id;
  if (Portfolio) {
    try {
      let projects;
      if (isSeq) projects = (await Portfolio.findAll({ where:{ user_id: userId }, order:[['createdAt','DESC']] })).map(p => p.toJSON ? p.toJSON() : p);
      if (isMng) projects = await Portfolio.find({ user_id: userId }).sort({ createdAt:-1 }).lean();
      if (projects) return ok(res, { projects });
    } catch(e) {}
  }
  ok(res, { projects: [] });
}));


// ═══════════════════════════════════════════════════════════════
//  ADMIN — TOGGLE RFP FEATURED
// ═══════════════════════════════════════════════════════════════

router.put('/admin/projects/:id/featured', protect, adminOnly, wrap(async (req, res) => {
  const id       = req.params.id;
  const featured = !!req.body.featured;
  if (RFP) {
    try {
      if (isSeq) await RFP.update({ featured }, { where:{ id } });
      if (isMng) await RFP.findByIdAndUpdate(id, { featured });
    } catch(e) {}
  }
  ok(res, { featured }, 'RFP featured status updated');
}));


router.use((error, req, res, next) => {
  console.error('[ext error]', error.message);
  res.status(error.status||500).json({
    status : 'error',
    error  : { message: error.message || 'Internal server error' },
  });
});

module.exports = router;
