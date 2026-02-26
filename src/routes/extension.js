/**
 * BuildConnect Pro — src/routes/extension.js
 * ============================================
 * Handles all dashboard routes: posts, rfps, messages,
 * notifications, online presence, members, profile update,
 * media upload, and admin actions.
 *
 * Save this file as:  src/routes/extension.js
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { Op }     = require('sequelize');
const sequelize  = require('../config/database');
let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch(e) {}

// ─── Auth middleware (matches this project's exports) ──────────────
const { authenticate, authorize } = require('../middleware/auth');
const protect    = authenticate;
const adminOnly  = authorize('admin');

// ─── Core models ───────────────────────────────────────────────────
const User = require('../models/User');
const RFP  = require('../models/RFP');

// ─── Optional models (created automatically if missing) ────────────
let Post, Message, Notification, Proposal, LibraryFile, Portfolio, Review;
try { Post         = require('../models/Post');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { Proposal     = require('../models/Proposal');     } catch(e) {}
try { LibraryFile  = require('../models/LibraryFile');  } catch(e) {}
try { Portfolio    = require('../models/Portfolio');    } catch(e) {}
try { Review       = require('../models/Review');       } catch(e) {}

// ─── Cloudinary image uploads ─────────────────────────────────────
let cloudinary = null;
let multer     = null;
let upload     = null;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name : process.env.CLOUDINARY_CLOUD_NAME || 'dgxk9xgmh',
    api_key    : process.env.CLOUDINARY_API_KEY    || '152912546379282',
    api_secret : process.env.CLOUDINARY_API_SECRET || 'Nvnb7AhYoHsI2ZK0N7Fbcg1oODU',
  });
  // Use multer memoryStorage — files go to Cloudinary, not disk
  multer = require('multer');
  upload = multer({
    storage : multer.memoryStorage(),
    limits  : { fileSize: 8 * 1024 * 1024 }, // 8 MB
  });
  console.log('[ext] Cloudinary image uploads ready ✅');
} catch(e) {
  console.warn('[ext] Cloudinary/multer not installed. Run: npm install cloudinary multer');
}

// Helper: upload a single buffer to Cloudinary
function uploadToCloudinary(buffer, mimetype, folder = 'buildconnect') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

// ─── Response helpers ──────────────────────────────────────────────
const ok   = (res, data = {}, msg = 'Success') =>
  res.json({ status: 'success', message: msg, data });
const fail = (res, msg = 'Error', code = 400) =>
  res.status(code).json({ status: 'error', error: { message: msg } });
const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const uid  = req => req.user?.id || req.userId || '';

// ─── In-memory fallbacks (used when optional models don't exist) ───
const mem = {
  posts         : [],
  messages      : [],
  notifications : [],
  proposals     : [],
  library       : [],
  online        : new Map(),
};
let _pid=1, _mid=1, _nid=1, _boid=1, _lid=1;

// ─── Helper: safe user lookup ──────────────────────────────────────
async function getUser(id) {
  if (!id) return null;
  try { return (await User.findByPk(id))?.toJSON() || null; } catch(e) { return null; }
}
async function getAllUsers() {
  try { return (await User.findAll({ where: { is_active: true } })).map(u => u.toJSON()); }
  catch(e) { return []; }
}

// ─── Helper: push a notification ──────────────────────────────────
async function pushNotif(userId, type, title, body = '') {
  const data = { id: String(_nid++), user_id: String(userId), type, title, body, is_read: false, createdAt: new Date() };
  if (Notification) {
    try { await Notification.create(data); return; } catch(e) {}
  }
  mem.notifications.unshift(data);
}

// ═══════════════════════════════════════════════════════════════════
//  ONLINE PRESENCE
// ═══════════════════════════════════════════════════════════════════

router.post('/online/heartbeat', protect, wrap(async (req, res) => {
  const id = String(uid(req));
  if (id) mem.online.set(id, Date.now());
  ok(res, { ok: true });
}));

router.get('/online/count', protect, wrap(async (req, res) => {
  const cut = Date.now() - 120000;
  for (const [k, t] of mem.online) { if (t < cut) mem.online.delete(k); }
  ok(res, { count: mem.online.size });
}));

router.get('/admin/online', protect, adminOnly, wrap(async (req, res) => {
  const cut = Date.now() - 120000;
  const sessions = [];
  for (const [userId, ts] of mem.online) {
    if (ts < cut) { mem.online.delete(userId); continue; }
    const u = await getUser(userId);
    sessions.push({ user_id: userId, last_seen: new Date(ts),
      user: u ? { id: userId, name: u.name, role: u.role } : { id: userId } });
  }
  ok(res, { sessions, count: sessions.length });
}));

// ═══════════════════════════════════════════════════════════════════
//  PROFILE UPDATE
//  Dashboard calls PUT /auth/updateMe (falls back to PUT /auth/me)
// ═══════════════════════════════════════════════════════════════════

async function handleProfileUpdate(req, res) {
  const userId = uid(req);
  const { name, company, location, bio } = req.body;
  const updates = {};
  if (name     !== undefined) updates.name     = name;
  if (company  !== undefined) updates.company  = company;
  if (location !== undefined) updates.location = location;
  if (bio      !== undefined) updates.bio      = bio;

  try {
    await User.update(updates, { where: { id: userId } });
    const updated = await User.findByPk(userId);
    ok(res, { user: updated ? updated.toPublicJSON() : { id: userId, ...updates } }, 'Profile updated');
  } catch(e) {
    fail(res, e.message || 'Update failed');
  }
}

router.put('/auth/updateMe', protect, wrap(handleProfileUpdate));
router.put('/auth/me',       protect, wrap(handleProfileUpdate));
router.patch('/auth/me',     protect, wrap(handleProfileUpdate));

// ═══════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

router.get('/notifications', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  let notifs = [];
  if (Notification) {
    try {
      notifs = (await Notification.findAll({
        where: { user_id: userId },
        order: [['createdAt', 'DESC']],
        limit: 50,
      })).map(n => n.toJSON());
    } catch(e) { notifs = mem.notifications.filter(n => n.user_id === userId); }
  } else {
    notifs = mem.notifications.filter(n => n.user_id === userId);
  }
  ok(res, { notifications: notifs, unread: notifs.filter(n => !n.is_read).length });
}));

router.put('/notifications/read-all', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  if (Notification) {
    try { await Notification.update({ is_read: true }, { where: { user_id: userId } }); }
    catch(e) {}
  }
  mem.notifications.filter(n => n.user_id === userId).forEach(n => { n.is_read = true; });
  ok(res, {}, 'All read');
}));

// ═══════════════════════════════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════════════════════════════

router.post('/messages', protect, wrap(async (req, res) => {
  const { receiver_id, subject = '', body } = req.body;
  const sender_id = String(uid(req));
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');

  const data = { sender_id, receiver_id, subject, body, is_read: false, createdAt: new Date() };
  let msg = null;
  if (Message) {
    try { msg = (await Message.create(data)).toJSON(); } catch(e) {}
  }
  if (!msg) {
    const sender   = await getUser(sender_id)   || { id: sender_id,   name: req.user?.name || '', role: '' };
    const receiver = await getUser(receiver_id) || { id: receiver_id, name: 'Member', role: '' };
    msg = { ...data, id: String(_mid++), sender, receiver };
    mem.messages.unshift(msg);
  }
  await pushNotif(receiver_id, 'message',
    `New message from ${req.user?.name || 'a member'}`, subject || String(body).slice(0, 80));
  ok(res, { message: msg }, 'Message sent');
}));

router.get('/messages/inbox', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  let msgs = [];
  if (Message) {
    try {
      msgs = (await Message.findAll({
        where: { [Op.or]: [{ sender_id: userId }, { receiver_id: userId }] },
        order: [['createdAt', 'DESC']],
        limit: 200,
        include: [
          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
        ],
      })).map(m => m.toJSON());
    } catch(e) { msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId); }
  } else {
    msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId);
  }
  ok(res, { messages: msgs });
}));

router.get('/messages', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  let msgs = [];
  if (Message) {
    try {
      msgs = (await Message.findAll({
        where: { [Op.or]: [{ sender_id: userId }, { receiver_id: userId }] },
        order: [['createdAt', 'DESC']],
        limit: 200,
        include: [
          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
        ],
      })).map(m => m.toJSON());
    } catch(e) { msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId); }
  } else {
    msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId);
  }
  ok(res, { messages: msgs });
}));

router.put('/messages/:id/read', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  if (Message) {
    try { await Message.update({ is_read: true }, { where: { id: req.params.id, receiver_id: userId } }); }
    catch(e) {}
  }
  const m = mem.messages.find(m => m.id === req.params.id);
  if (m) m.is_read = true;
  ok(res, {}, 'Read');
}));

router.delete('/messages/:id', protect, wrap(async (req, res) => {
  if (Message) {
    try { await Message.destroy({ where: { id: req.params.id } }); } catch(e) {}
  }
  mem.messages = mem.messages.filter(m => m.id !== req.params.id);
  ok(res, {}, 'Deleted');
}));

// ─── Admin messages ────────────────────────────────────────────────

router.get('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  let msgs = [];
  if (Message) {
    try {
      msgs = (await Message.findAll({
        order: [['createdAt', 'DESC']], limit: 200,
        include: [
          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
        ],
      })).map(m => m.toJSON());
    } catch(e) { msgs = [...mem.messages]; }
  } else { msgs = [...mem.messages]; }
  ok(res, { messages: msgs });
}));

router.post('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  const { receiver_id, subject = '', body } = req.body;
  const sender_id = String(uid(req));
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');
  const data = { sender_id, receiver_id, subject, body, is_read: false, createdAt: new Date() };
  let msg = null;
  if (Message) { try { msg = (await Message.create(data)).toJSON(); } catch(e) {} }
  if (!msg) {
    const r = await getUser(receiver_id) || { id: receiver_id, name: 'Member', email: '', role: '' };
    msg = { ...data, id: String(_mid++),
      sender:   { id: sender_id,   name: req.user?.name || 'Admin', role: 'admin' },
      receiver: { id: receiver_id, name: r.name, email: r.email || '', role: r.role || '' },
    };
    mem.messages.unshift(msg);
  }
  await pushNotif(receiver_id, 'message',
    `Message from Admin${subject ? ': ' + subject : ''}`, String(body).slice(0, 100));
  ok(res, { message: msg }, 'Message sent');
}));

router.delete('/admin/messages/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Message) { try { await Message.destroy({ where: { id: req.params.id } }); } catch(e) {} }
  mem.messages = mem.messages.filter(m => m.id !== req.params.id);
  ok(res, {}, 'Deleted');
}));

// ─── Broadcast ────────────────────────────────────────────────────

router.post('/admin/broadcast', protect, adminOnly, wrap(async (req, res) => {
  const { title, body = '', type = 'info' } = req.body;
  if (!title) return fail(res, 'title is required');
  const sender_id = String(uid(req));
  const users     = await getAllUsers();
  let sent        = 0;
  for (const u of users) {
    const receiverId = String(u.id);
    await pushNotif(receiverId, 'system', title, body);
    const data = { sender_id, receiver_id: receiverId,
      subject: `[Broadcast] ${title}`, body: body || title, is_read: false, createdAt: new Date() };
    let saved = false;
    if (Message) { try { await Message.create(data); saved = true; } catch(e) {} }
    if (!saved) {
      mem.messages.unshift({ ...data, id: String(_mid++),
        sender:   { id: sender_id,   name: req.user?.name || 'Admin', role: 'admin' },
        receiver: { id: receiverId,  name: u.name || 'Member' },
      });
    }
    sent++;
  }
  ok(res, { sent }, `Broadcast sent to ${sent} members`);
}));

// ═══════════════════════════════════════════════════════════════════
//  POSTS  (community feed)
//  NOTE: /posts/upload MUST be registered before /posts/:id
// ═══════════════════════════════════════════════════════════════════

// ── Media upload → Cloudinary ─────────────────────────────────────
router.post('/posts/upload', protect, (req, res, next) => {
  if (!upload) return ok(res, { files: [] }, 'Image uploads disabled — run: npm install cloudinary multer');
  upload.array('files', 10)(req, res, err => {
    if (err) return fail(res, err.message || 'Upload error', 400);
    next();
  });
}, wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return ok(res, { files: [] }, 'No files received');

  // Upload each file to Cloudinary
  const result = await Promise.all(files.map(async f => {
    try {
      const cld = await uploadToCloudinary(f.buffer, f.mimetype);
      return {
        type   : f.mimetype.startsWith('image/') ? 'image' : 'file',
        url    : cld.secure_url,   // permanent Cloudinary HTTPS URL
        name   : f.originalname,
        public_id : cld.public_id,
      };
    } catch(e) {
      console.error('[ext] Cloudinary upload error:', e.message);
      return null;
    }
  }));

  const uploaded = result.filter(Boolean);
  ok(res, { files: uploaded }, `${uploaded.length} file(s) uploaded`);
}));

// ── GET paginated feed ────────────────────────────────────────────
router.get('/posts', protect, wrap(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;
  let posts = [];
  if (Post) {
    try {
      posts = (await Post.findAll({
        order   : [['createdAt', 'DESC']],
        limit, offset,
        include : [{ model: User, as: 'author', attributes: ['id','name','email','role','company','subscription_tier'], required: false }],
      })).map(p => p.toJSON());
    } catch(e) { posts = mem.posts.slice(offset, offset + limit); }
  } else { posts = mem.posts.slice(offset, offset + limit); }
  ok(res, { posts, page, limit });
}));

// ── CREATE post ───────────────────────────────────────────────────
router.post('/posts', protect, wrap(async (req, res) => {
  const author_id = String(uid(req));
  const { body, rfp_id, media } = req.body;
  if (!body) return fail(res, 'body is required');
  const data = { author_id, body, rfp_id: rfp_id || null,
    media: media || [], likes: [], comments: [], is_pinned: false, createdAt: new Date() };
  let post = null;
  if (Post) {
    try { post = (await Post.create(data)).toJSON(); } catch(e) {}
  }
  if (!post) {
    post = { ...data, id: String(_pid++) };
    mem.posts.unshift(post);
  }
  const author = await getUser(author_id);
  if (author) post.author = { id: author_id, name: author.name, email: author.email, role: author.role, company: author.company || '', subscription_tier: author.subscription_tier || 'free' };
  ok(res, { post }, 'Post created');
}));

// ── LIKE / unlike ─────────────────────────────────────────────────
router.post('/posts/:id/like', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  let post = null;
  if (Post) { try { post = (await Post.findByPk(req.params.id))?.toJSON() || null; } catch(e) {} }
  if (!post) post = mem.posts.find(p => p.id === req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  const likes    = (Array.isArray(post.likes) ? post.likes : []).map(String);
  const liked    = likes.includes(userId);
  const newLikes = liked ? likes.filter(id => id !== userId) : [...likes, userId];
  if (Post) { try { await Post.update({ likes: newLikes }, { where: { id: req.params.id } }); } catch(e) {} }
  const mp = mem.posts.find(p => p.id === req.params.id);
  if (mp) mp.likes = newLikes;
  ok(res, { liked: !liked, likes: newLikes });
}));

// ── ADD comment ───────────────────────────────────────────────────
router.post('/posts/:id/comments', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  const { body } = req.body;
  if (!body) return fail(res, 'body is required');
  const author  = await getUser(userId) || { id: userId, name: req.user?.name || 'Member', role: req.user?.role || '' };
  const comment = { id: String(Date.now()), author: { id: userId, name: author.name, role: author.role }, body, createdAt: new Date() };
  if (Post) {
    try {
      const p = await Post.findByPk(req.params.id);
      if (p) {
        const comments = [...(p.comments || []), comment];
        await Post.update({ comments }, { where: { id: req.params.id } });
      }
    } catch(e) {}
  }
  const mp = mem.posts.find(p => p.id === req.params.id);
  if (mp) mp.comments = [...(mp.comments || []), comment];
  ok(res, { comment }, 'Comment added');
}));

// ── DELETE post ───────────────────────────────────────────────────
router.delete('/posts/:id', protect, wrap(async (req, res) => {
  const userId = String(uid(req));
  let post = null;
  if (Post) { try { post = (await Post.findByPk(req.params.id))?.toJSON() || null; } catch(e) {} }
  if (!post) post = mem.posts.find(p => p.id === req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  if (String(post.author_id) !== userId && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  if (Post) { try { await Post.destroy({ where: { id: req.params.id } }); } catch(e) {} }
  mem.posts = mem.posts.filter(p => p.id !== req.params.id);
  ok(res, {}, 'Post deleted');
}));

// ── Admin posts ───────────────────────────────────────────────────
router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
  let posts = [];
  if (Post) {
    try {
      posts = (await Post.findAll({
        order: [['createdAt', 'DESC']], limit: 100,
        include: [{ model: User, as: 'author', attributes: ['id','name','role'], required: false }],
      })).map(p => p.toJSON());
    } catch(e) { posts = [...mem.posts]; }
  } else { posts = [...mem.posts]; }
  ok(res, { posts });
}));

router.put('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Post) { try { await Post.update(req.body, { where: { id: req.params.id } }); } catch(e) { return fail(res, e.message); } }
  const mp = mem.posts.find(p => p.id === req.params.id);
  if (mp) Object.assign(mp, req.body);
  ok(res, {}, 'Updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  RFPs
//  ⚠️  /rfps/my  MUST come before  /rfps/:id  (Express route order)
// ═══════════════════════════════════════════════════════════════════

// ── GET all open RFPs (professionals browsing) ────────────────────
router.get('/rfps', protect, wrap(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  try {
    const rfps = (await RFP.findAll({
      where   : { status: 'open' },
      order   : [['createdAt', 'DESC']],
      limit, offset,
      include : [{ model: User, as: 'client', attributes: ['id','name','company','role'], required: false }],
    })).map(r => r.toJSON());
    ok(res, { rfps, page, limit });
  } catch(e) { fail(res, e.message); }
}));

// ── GET my RFPs (clients) — MUST be before /:id ───────────────────
router.get('/rfps/my', protect, wrap(async (req, res) => {
  const userId = uid(req);
  try {
    const rfps = (await RFP.findAll({
      where : { client_id: userId },
      order : [['createdAt', 'DESC']],
      include: [{ model: User, as: 'client', attributes: ['id','name','company'], required: false }],
    })).map(r => r.toJSON());
    ok(res, { rfps });
  } catch(e) { fail(res, e.message); }
}));

// ── GET single RFP ────────────────────────────────────────────────
router.get('/rfps/:id', protect, wrap(async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id, {
      include: [{ model: User, as: 'client', attributes: ['id','name','company','role'], required: false }],
    });
    if (!rfp) return fail(res, 'RFP not found', 404);
    // Increment view count
    await rfp.increment('view_count').catch(() => {});
    ok(res, { rfp: rfp.toJSON() });
  } catch(e) { fail(res, e.message); }
}));

// ── CREATE RFP ────────────────────────────────────────────────────
router.post('/rfps', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { title, description, project_type, proposal_deadline,
          budget_min, budget_max, currency = 'USD',
          privacy_level = 'public', status = 'draft', location, industry } = req.body;
  if (!title)             return fail(res, 'title is required');
  if (!description)       return fail(res, 'description is required');
  if (!project_type)      return fail(res, 'project_type is required');
  if (!proposal_deadline) return fail(res, 'proposal_deadline is required');
  try {
    const rfp = await RFP.create({
      client_id : userId, title, description, project_type,
      proposal_deadline: new Date(proposal_deadline),
      budget_min: budget_min ? parseFloat(budget_min) : null,
      budget_max: budget_max ? parseFloat(budget_max) : null,
      currency, privacy_level, status,
      location: location || null,
      view_count: 0,
    });
    ok(res, { rfp: rfp.toJSON() }, 'RFP created');
  } catch(e) { fail(res, e.message); }
}));

// ── PUBLISH RFP (draft → open) ────────────────────────────────────
router.post('/rfps/:id/publish', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await rfp.update({ status: 'open' });
  ok(res, {}, 'RFP published');
}));

// ── CLOSE RFP ─────────────────────────────────────────────────────
router.post('/rfps/:id/close', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await rfp.update({ status: 'completed' });
  ok(res, {}, 'RFP closed');
}));

// ── SUBMIT proposal / BOQ ─────────────────────────────────────────
router.post('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const { cover_letter, proposed_budget, currency = 'USD',
          estimated_duration, start_date, relevant_experience,
          proposed_team, notes, boq_items, boq_total } = req.body;
  if (!cover_letter)       return fail(res, 'cover_letter is required');
  if (!proposed_budget)    return fail(res, 'proposed_budget is required');
  if (!estimated_duration) return fail(res, 'estimated_duration is required');
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  const data = {
    rfp_id: req.params.id, professional_id: userId,
    cover_letter, proposed_budget: parseFloat(proposed_budget), currency,
    estimated_duration, start_date: start_date || null,
    relevant_experience: relevant_experience || '',
    proposed_team: proposed_team || '', notes: notes || '',
    boq_items: boq_items || [], boq_total: boq_total || 0,
    status: 'submitted', createdAt: new Date(),
  };
  let proposal = null;
  if (Proposal) { try { proposal = (await Proposal.create(data)).toJSON(); } catch(e) {} }
  if (!proposal) { proposal = { ...data, id: String(_boid++) }; mem.proposals.unshift(proposal); }
  const prof = await getUser(userId);
  await pushNotif(String(rfp.client_id), 'rfp',
    `New proposal for: ${rfp.title}`,
    `${prof?.name || 'A professional'} submitted a proposal — Budget: ${currency} ${parseFloat(proposed_budget).toLocaleString()}`
  );
  ok(res, { proposal }, 'Proposal submitted');
}));

// ── GET proposals for an RFP (client owner + admin) ───────────────
router.get('/rfps/:id/proposals', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const rfp    = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  let proposals = [];
  if (Proposal) {
    try {
      proposals = (await Proposal.findAll({
        where: { rfp_id: req.params.id }, order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'professional', attributes: ['id','name','company','role'], required: false }],
      })).map(p => p.toJSON());
    } catch(e) { proposals = mem.proposals.filter(p => p.rfp_id === req.params.id); }
  } else { proposals = mem.proposals.filter(p => p.rfp_id === req.params.id); }
  ok(res, { proposals });
}));

// ═══════════════════════════════════════════════════════════════════
//  MEMBERS DIRECTORY
// ═══════════════════════════════════════════════════════════════════

router.get('/members', protect, wrap(async (req, res) => {
  const q     = (req.query.q || '').toLowerCase();
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  let users   = await getAllUsers();
  if (q) users = users.filter(u =>
    (u.name||'').toLowerCase().includes(q) ||
    (u.company||'').toLowerCase().includes(q) ||
    (u.role||'').toLowerCase().includes(q)
  );
  const members = users.slice(0, limit).map(u => ({
    id: u.id, name: u.name, company: u.company || '',
    role: u.role || '', location: u.location || '', bio: u.bio || '',
    subscription_tier: u.subscription_tier || 'free',
    is_verified: u.is_verified || false, createdAt: u.createdAt,
  }));
  ok(res, { members, total: members.length });
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — SUBSCRIPTION, BAN, STATS
// ═══════════════════════════════════════════════════════════════════

// ── Admin: list all users ─────────────────────────────────────────
router.get('/admin/users', protect, adminOnly, wrap(async (req, res) => {
  try {
    const users = (await User.findAll({ order: [['createdAt','DESC']] })).map(u => u.toPublicJSON());
    ok(res, { users, total: users.length });
  } catch(e) { fail(res, e.message); }
}));

// ── Admin: delete a user ──────────────────────────────────────────
router.delete('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  try {
    await User.destroy({ where: { id: req.params.id } });
    ok(res, {}, 'User deleted');
  } catch(e) { fail(res, e.message); }
}));

// ── Admin: update any user field (name, role, company, is_active, etc.) ──
router.put('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  const allowed = ['name','role','company','location','bio','is_active','is_verified'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return fail(res, 'No valid fields to update');
  try {
    await User.update(updates, { where: { id: req.params.id } });
    const updated = await User.findByPk(req.params.id);
    // Notify user if role changed
    if (updates.role) {
      await pushNotif(req.params.id, 'system',
        `Your account role has been updated to: ${updates.role}`, '');
    }
    ok(res, { user: updated ? updated.toPublicJSON() : { id: req.params.id } }, 'User updated');
  } catch(e) { fail(res, e.message); }
}));

router.put('/admin/users/:id/subscription', protect, adminOnly, wrap(async (req, res) => {
  const { tier, status = 'active', end_date, note } = req.body;
  const userId = req.params.id;
  const subEnd = end_date ? new Date(end_date) : null;
  await User.update({
    subscription_tier: tier || 'free', subscription_status: status,
    subscription_end: subEnd,
  }, { where: { id: userId } });
  const labels = { monthly: 'Monthly Pro', annual: 'Annual Pro', free: 'Free' };
  let msg = `Your plan has been updated to ${labels[tier] || tier}`;
  if (subEnd) msg += subEnd.getFullYear() >= 2099 ? ' — permanent access granted!'
    : ` — valid until ${subEnd.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;
  await pushNotif(userId, 'system', msg, note || '');
  const updated = await User.findByPk(userId);
  ok(res, { user: updated ? updated.toPublicJSON() : { id: userId } }, 'Subscription updated');
}));

router.put('/admin/users/:id/ban', protect, adminOnly, wrap(async (req, res) => {
  const { banned } = req.body;
  await User.update({ is_active: !banned }, { where: { id: req.params.id } });
  await pushNotif(req.params.id, 'ban',
    banned ? 'Your account has been suspended' : 'Your account has been reinstated');
  ok(res, {}, banned ? 'User banned' : 'User unbanned');
}));

router.get('/admin/stats-extended', protect, adminOnly, wrap(async (req, res) => {
  const users   = await getAllUsers();
  const monthly = users.filter(u => u.subscription_tier === 'monthly' && u.subscription_status === 'active').length;
  const annual  = users.filter(u => u.subscription_tier === 'annual'  && u.subscription_status === 'active').length;
  let openRfps  = 0;
  try { openRfps = await RFP.count({ where: { status: 'open' } }); } catch(e) {}
  let totalPosts = 0;
  if (Post) { try { totalPosts = await Post.count(); } catch(e) {} }
  ok(res, {
    users        : users.length,
    monthly_subs : monthly,
    annual_subs  : annual,
    free_users   : users.filter(u => !u.subscription_tier || u.subscription_tier === 'free').length,
    mrr          : monthly * 49 + annual * 39,
    arr          : (monthly * 49 + annual * 39) * 12,
    open_rfps    : openRfps,
    posts        : totalPosts,
    messages     : mem.messages.length,
    broadcasts   : 0,
  });
}));

// ═══════════════════════════════════════════════════════════════════
//  LIBRARY
// ═══════════════════════════════════════════════════════════════════

// GET all active library files (members only)
router.get('/library', protect, wrap(async (req, res) => {
  const cat = req.query.category || null;
  let files = [];
  if (LibraryFile) {
    try {
      const where = { is_active: true };
      if (cat) where.category = cat;
      files = (await LibraryFile.findAll({
        where,
        order: [['createdAt', 'DESC']],
      })).map(f => f.toJSON());
    } catch(e) { files = mem.library.filter(f => f.is_active && (!cat || f.category === cat)); }
  } else {
    files = mem.library.filter(f => f.is_active && (!cat || f.category === cat));
  }
  ok(res, { files, total: files.length });
}));

// POST add a new library file (admin only)
router.post('/library', protect, adminOnly, wrap(async (req, res) => {
  const { title, description, category, url, filetype, size, access } = req.body;
  if (!title) return fail(res, 'title is required');
  if (!url)   return fail(res, 'url is required');
  const data = {
    title, description: description || '',
    category: category || 'catalogue',
    url, filetype: filetype || 'PDF',
    size: size || '',
    access: access || 'pro_only',
    is_active: true,
    download_count: 0,
    uploaded_by: uid(req),
    createdAt: new Date(),
  };
  let file = null;
  if (LibraryFile) {
    try { file = (await LibraryFile.create(data)).toJSON(); } catch(e) { console.error('[lib]', e.message); }
  }
  if (!file) { file = { ...data, id: String(_lid++) }; mem.library.unshift(file); }
  ok(res, { file }, 'File added to library');
}));

// PUT update library file (admin only)
router.put('/library/:id', protect, adminOnly, wrap(async (req, res) => {
  const allowed = ['title','description','category','url','filetype','size','access','is_active'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (LibraryFile) {
    try { await LibraryFile.update(updates, { where: { id: req.params.id } }); } catch(e) {}
  }
  const ml = mem.library.find(f => f.id === req.params.id);
  if (ml) Object.assign(ml, updates);
  ok(res, {}, 'Updated');
}));

// DELETE library file (admin only)
router.delete('/library/:id', protect, adminOnly, wrap(async (req, res) => {
  if (LibraryFile) {
    try { await LibraryFile.destroy({ where: { id: req.params.id } }); } catch(e) {}
  }
  mem.library = mem.library.filter(f => f.id !== req.params.id);
  ok(res, {}, 'Deleted');
}));

// POST increment download count
router.post('/library/:id/download', protect, wrap(async (req, res) => {
  if (LibraryFile) {
    try { await LibraryFile.increment('download_count', { where: { id: req.params.id } }); } catch(e) {}
  }
  ok(res, {}, 'Counted');
}));

// ═══════════════════════════════════════════════════════════════════
//  AI PROJECT MATCHING
// ═══════════════════════════════════════════════════════════════════

// Helper: build professional profile summary for AI
function buildProfSummary(user, portfolio = []) {
  const parts = [];
  parts.push(`Name: ${user.name}`);
  parts.push(`Company: ${user.company || 'Independent'}`);
  parts.push(`Location: ${user.location || 'Not specified'}`);
  if (user.bio) parts.push(`Bio: ${user.bio}`);
  if (portfolio.length) {
    parts.push(`Portfolio projects (${portfolio.length}):`);
    portfolio.slice(0, 5).forEach(p => {
      parts.push(`  - ${p.title} | Type: ${p.project_type || 'N/A'} | Location: ${p.location || 'N/A'} | Value: ${p.project_value ? '$' + Number(p.project_value).toLocaleString() : 'N/A'}`);
      if (p.description) parts.push(`    ${p.description.slice(0, 100)}`);
    });
  }
  return parts.join('\n');
}

// GET /rfps/:id/matches — get AI top 5 matches for an RFP
router.get('/rfps/:id/matches', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);

  // Check cache first (stored on RFP)
  if (rfp.ai_matches && rfp.ai_matches_at) {
    const age = Date.now() - new Date(rfp.ai_matches_at).getTime();
    if (age < 24 * 60 * 60 * 1000) { // cache 24h
      return ok(res, { matches: rfp.ai_matches, cached: true });
    }
  }

  // Get all active professionals
  const professionals = await User.findAll({
    where: { role: 'professional', is_active: true },
    attributes: ['id', 'name', 'company', 'location', 'bio', 'subscription_tier'],
  });

  if (!professionals.length) return ok(res, { matches: [] });

  // Load portfolios for all professionals
  let portfolioMap = {};
  if (Portfolio) {
    const allPortfolios = await Portfolio.findAll({
      where: { user_id: professionals.map(p => p.id) },
    });
    allPortfolios.forEach(p => {
      if (!portfolioMap[p.user_id]) portfolioMap[p.user_id] = [];
      portfolioMap[p.user_id].push(p.toJSON());
    });
  }

  // Build RFP summary
  const rfpData = rfp.toJSON ? rfp.toJSON() : rfp;
  const rfpSummary = [
    `Title: ${rfpData.title}`,
    `Type: ${rfpData.project_type || rfpData.industry?.join(', ') || 'N/A'}`,
    `Location: ${rfpData.location?.city || rfpData.location || 'N/A'}, ${rfpData.location?.country || ''}`,
    `Budget: ${rfpData.budget_min ? '$' + rfpData.budget_min.toLocaleString() : 'N/A'} - ${rfpData.budget_max ? '$' + rfpData.budget_max.toLocaleString() : 'N/A'}`,
    `Description: ${rfpData.description?.slice(0, 300) || 'N/A'}`,
  ].join('\n');

  // Build professionals list for AI
  const profsList = professionals.map(p => ({
    id: p.id,
    summary: buildProfSummary(p.toJSON(), portfolioMap[p.id] || []),
  }));

  // Ask Claude to match
  let matches = [];

  if (Anthropic && process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const profsText = profsList.map((p, i) =>
        `[PROFESSIONAL ${i+1}] ID: ${p.id}\n${p.summary}`
      ).join('\n\n---\n\n');

      const prompt = `You are a professional project matching AI for a construction and architecture marketplace.

ANALYZE this RFP and find the TOP 5 best matching professionals.

=== RFP ===
${rfpSummary}

=== PROFESSIONALS ===
${profsText}

MATCHING CRITERIA (in order of importance):
1. Location match — same city/country/region scores highest
2. Project type match — portfolio projects similar to RFP type
3. Portfolio experience — relevant past projects
4. Company/bio relevance

Respond ONLY with valid JSON in this exact format, nothing else:
{
  "matches": [
    {
      "id": "professional-uuid-here",
      "score": 95,
      "reason": "One sentence explaining why they are a great match"
    }
  ]
}

Return exactly 5 matches (or fewer if less than 5 professionals exist). Order by score descending.`;

      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      matches = parsed.matches || [];

    } catch (e) {
      console.error('[AI Match] Error:', e.message);
      // Fallback: simple scoring without AI
      matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
    }
  } else {
    // No AI key — use simple scoring
    matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
  }

  // Enrich matches with user data
  const enriched = await Promise.all(matches.slice(0, 5).map(async m => {
    const user = professionals.find(p => String(p.id) === String(m.id));
    if (!user) return null;
    const portfolio = portfolioMap[m.id] || [];
    return {
      id: m.id,
      name: user.name,
      company: user.company || 'Independent',
      location: user.location || '',
      bio: user.bio || '',
      subscription_tier: user.subscription_tier,
      portfolio_count: portfolio.length,
      portfolio_preview: portfolio.slice(0, 2).map(p => ({ title: p.title, type: p.project_type })),
      score: m.score,
      reason: m.reason,
    };
  }));

  const finalMatches = enriched.filter(Boolean);

  // Cache on RFP record if possible
  try {
    await RFP.update(
      { ai_matches: finalMatches, ai_matches_at: new Date() },
      { where: { id: req.params.id } }
    );
  } catch(e) {}

  ok(res, { matches: finalMatches });
}));

// POST /rfps/:id/matches/notify — notify matched professionals
router.post('/rfps/:id/matches/notify', protect, wrap(async (req, res) => {
  const rfp = await RFP.findByPk(req.params.id);
  if (!rfp) return fail(res, 'RFP not found', 404);
  // Only RFP owner or admin can notify
  const rfpData = rfp.toJSON ? rfp.toJSON() : rfp;
  if (String(rfpData.client_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);

  const { matches } = req.body;
  if (!matches?.length) return fail(res, 'No matches provided');

  let notified = 0;
  for (const m of matches) {
    try {
      await pushNotif(
        m.id,
        'match',
        `🎯 New Project Match: ${rfpData.title}`,
        `You've been matched to a project that fits your profile! ${m.reason || ''} Click to view and submit a proposal.`
      );
      notified++;
    } catch(e) {}
  }

  ok(res, { notified }, `Notified ${notified} professionals`);
}));

// Simple fallback scoring without AI
function simpleFallbackMatch(rfp, professionals, portfolioMap) {
  const rfpLocation = (rfp.location?.country || rfp.location || '').toLowerCase();
  const rfpType = (rfp.project_type || rfp.industry?.[0] || '').toLowerCase();

  return professionals.map(p => {
    let score = 50;
    const pData = p.toJSON ? p.toJSON() : p;
    const portfolio = portfolioMap[p.id] || [];

    // Location match
    const pLoc = (pData.location || '').toLowerCase();
    if (rfpLocation && pLoc && pLoc.includes(rfpLocation.split(',')[0])) score += 25;
    else if (rfpLocation && pLoc && rfpLocation.includes(pLoc.split(',')[0])) score += 15;

    // Project type match in portfolio
    if (rfpType) {
      const typeMatch = portfolio.filter(proj =>
        (proj.project_type || '').toLowerCase().includes(rfpType) ||
        rfpType.includes((proj.project_type || '').toLowerCase())
      );
      score += Math.min(typeMatch.length * 10, 20);
    }

    // Portfolio size bonus
    score += Math.min(portfolio.length * 2, 10);

    return {
      id: p.id,
      score: Math.min(score, 99),
      reason: `${pData.company || pData.name} has ${portfolio.length} portfolio projects and is based in ${pData.location || 'N/A'}.`
    };
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════
//  PORTFOLIO
// ═══════════════════════════════════════════════════════════════════

// GET portfolio for a user
router.get('/portfolio/:userId', protect, wrap(async (req, res) => {
  if (!Portfolio) return ok(res, { portfolio: [] });
  try {
    const portfolio = (await Portfolio.findAll({
      where: { user_id: req.params.userId },
      order: [['createdAt', 'DESC']],
    })).map(p => p.toJSON());
    ok(res, { portfolio });
  } catch(e) { fail(res, e.message); }
}));

// GET my portfolio
router.get('/portfolio', protect, wrap(async (req, res) => {
  if (!Portfolio) return ok(res, { portfolio: [] });
  try {
    const portfolio = (await Portfolio.findAll({
      where: { user_id: uid(req) },
      order: [['createdAt', 'DESC']],
    })).map(p => p.toJSON());
    ok(res, { portfolio });
  } catch(e) { fail(res, e.message); }
}));

// POST create portfolio item
router.post('/portfolio', protect, wrap(async (req, res) => {
  const { title, description, project_type, location, completion_date,
          project_value, currency, images } = req.body;
  if (!title) return fail(res, 'title is required');
  if (!Portfolio) return fail(res, 'Portfolio model not available');
  try {
    const item = await Portfolio.create({
      user_id: uid(req), title, description, project_type,
      location, completion_date: completion_date ? new Date(completion_date) : null,
      project_value: project_value ? parseFloat(project_value) : null,
      currency: currency || 'USD',
      images: images || [],
    });
    ok(res, { item: item.toJSON() }, 'Portfolio item added');
  } catch(e) { fail(res, e.message); }
}));

// PUT update portfolio item
router.put('/portfolio/:id', protect, wrap(async (req, res) => {
  if (!Portfolio) return fail(res, 'Portfolio model not available');
  const item = await Portfolio.findByPk(req.params.id);
  if (!item) return fail(res, 'Not found', 404);
  if (String(item.user_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  const allowed = ['title','description','project_type','location','completion_date',
                   'project_value','currency','images','is_featured'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  await item.update(updates);
  ok(res, { item: item.toJSON() }, 'Updated');
}));

// DELETE portfolio item
router.delete('/portfolio/:id', protect, wrap(async (req, res) => {
  if (!Portfolio) return fail(res, 'Portfolio model not available');
  const item = await Portfolio.findByPk(req.params.id);
  if (!item) return fail(res, 'Not found', 404);
  if (String(item.user_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await item.destroy();
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  REVIEWS
// ═══════════════════════════════════════════════════════════════════

// Helper: calculate average ratings for a user
async function getAvgRatings(userId) {
  if (!Review) return null;
  try {
    const reviews = await Review.findAll({
      where: { reviewee_id: userId, is_approved: true },
    });
    if (!reviews.length) return null;
    const avg = (key) => {
      const vals = reviews.map(r => r[key]).filter(v => v > 0);
      return vals.length ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 10) / 10 : null;
    };
    return {
      overall      : avg('rating_overall'),
      quality      : avg('rating_quality'),
      communication: avg('rating_communication'),
      timeline     : avg('rating_timeline'),
      count        : reviews.length,
    };
  } catch(e) { return null; }
}

// GET reviews for a user
router.get('/reviews/:userId', protect, wrap(async (req, res) => {
  if (!Review) return ok(res, { reviews: [], ratings: null });
  try {
    const reviews = (await Review.findAll({
      where: { reviewee_id: req.params.userId, is_approved: true },
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'reviewer', attributes: ['id','name','company','role'], required: false },
      ],
    })).map(r => r.toJSON());
    const ratings = await getAvgRatings(req.params.userId);
    ok(res, { reviews, ratings });
  } catch(e) { fail(res, e.message); }
}));

// POST write a review
router.post('/reviews', protect, wrap(async (req, res) => {
  const { reviewee_id, rfp_id, rating_overall, rating_quality,
          rating_communication, rating_timeline, body } = req.body;
  if (!reviewee_id)    return fail(res, 'reviewee_id is required');
  if (!rating_overall) return fail(res, 'rating_overall is required');
  if (!body)           return fail(res, 'Written review is required');
  if (String(reviewee_id) === String(uid(req)))
    return fail(res, 'You cannot review yourself');
  if (!Review) return fail(res, 'Review model not available');
  // Check: one review per reviewer per reviewee
  const existing = await Review.findOne({
    where: { reviewee_id, reviewer_id: uid(req) }
  });
  if (existing) return fail(res, 'You have already reviewed this member');
  try {
    const review = await Review.create({
      reviewee_id, reviewer_id: uid(req), rfp_id: rfp_id || null,
      rating_overall: parseInt(rating_overall),
      rating_quality: rating_quality ? parseInt(rating_quality) : null,
      rating_communication: rating_communication ? parseInt(rating_communication) : null,
      rating_timeline: rating_timeline ? parseInt(rating_timeline) : null,
      body, is_approved: true,
    });
    await pushNotif(reviewee_id, 'review',
      `New review from ${req.user?.name || 'a client'}`,
      `Rating: ${rating_overall}/5 — "${String(body).slice(0,80)}"`
    );
    ok(res, { review: review.toJSON() }, 'Review submitted');
  } catch(e) { fail(res, e.message); }
}));

// DELETE review (own or admin)
router.delete('/reviews/:id', protect, wrap(async (req, res) => {
  if (!Review) return fail(res, 'Review model not available');
  const review = await Review.findByPk(req.params.id);
  if (!review) return fail(res, 'Not found', 404);
  if (String(review.reviewer_id) !== String(uid(req)) && req.user?.role !== 'admin')
    return fail(res, 'Not authorised', 403);
  await review.destroy();
  ok(res, {}, 'Deleted');
}));

// Admin: approve/reject review
router.put('/admin/reviews/:id', protect, adminOnly, wrap(async (req, res) => {
  if (!Review) return fail(res, 'Review model not available');
  await Review.update({ is_approved: req.body.is_approved }, { where: { id: req.params.id } });
  ok(res, {}, 'Updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════

router.use((err, req, res, next) => {
  console.error('[ext]', err.message);
  res.status(err.status || 500).json({
    status: 'error',
    error: { message: err.message || 'Internal server error' },
  });
});

module.exports = router;
