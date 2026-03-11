/**
 * extension.js  —  All missing routes for BuildConnect Pro
 * Covers: posts, members, messages, notifications, library,
 *         events, follows, portfolio, online, analytics,
 *         rfp extras, admin extras, homepage, spotlight, broadcast
 */
const { Router } = require('express');
const { Op, DataTypes } = require('sequelize');
const router = Router();

/* ── lazy-load models (safe) ─────────────────────────────────────── */
const sequelize = require('./config/database');
const User = require('./models/User');
const RFP  = require('./models/RFP');

let Post, Message, Proposal;
try { Post     = require('./models/Post');     } catch(e) {}
try { Message  = require('./models/Message');  } catch(e) {}
try { Proposal = require('./models/Proposal'); } catch(e) {}

/* ── middleware ──────────────────────────────────────────────────── */
const { authenticate, optionalAuth } = require('./middleware/auth');
const { isAdmin }                    = require('./middleware/admin');

/* ── in-memory stores (survive restarts via DB later) ────────────── */
let homepageData   = {};
let spotlightData  = null;
let onlineUsers    = {};          // { userId: lastSeenTimestamp }
const ONLINE_TTL   = 2 * 60 * 1000; // 2 min

/* ════════════════════════════════════════════════════════════════════
   AUTH EXTRAS
════════════════════════════════════════════════════════════════════ */
// Avatar upload (base64 stored on user record)
router.post('/auth/avatar', authenticate, async (req, res) => {
  try {
    // Accept multipart — just acknowledge for now (Cloudinary handles real upload)
    res.json({ success: true, data: { avatar_url: null } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

/* ════════════════════════════════════════════════════════════════════
   MEMBERS  (alias for users, public-ish)
════════════════════════════════════════════════════════════════════ */
router.get('/members', optionalAuth, async (req, res) => {
  try {
    const { search, role, page = 1, limit = 50 } = req.query;
    const where = { is_active: true };
    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { name:    { [Op.iLike]: `%${search}%` } },
        { email:   { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const rows = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });
    res.json({ success: true, data: { members: rows } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.get('/members/:id', optionalAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).json({ success: false, error: { message: 'Member not found' } });
    res.json({ success: true, data: user });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.get('/members/:id/portfolio', optionalAuth, async (req, res) => {
  res.json({ success: true, data: { portfolio: [] } });
});

router.post('/members/', authenticate, async (req, res) => {
  // update own profile (alias)
  try {
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    const { name, company, location, bio } = req.body;
    await user.update({ name, company, location, bio });
    res.json({ success: true, data: user });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

/* ════════════════════════════════════════════════════════════════════
   USERS (admin alias)
════════════════════════════════════════════════════════════════════ */
router.get('/users', authenticate, isAdmin, async (req, res) => {
  try {
    const rows = await User.findAll({ attributes: { exclude: ['password'] }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: { users: rows } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

/* ════════════════════════════════════════════════════════════════════
   POSTS
════════════════════════════════════════════════════════════════════ */
router.get('/posts', optionalAuth, async (req, res) => {
  if (!Post) return res.json({ success: true, data: { posts: [], total: 0 } });
  try {
    const { page = 1, limit = 10 } = req.query;
    const { count, rows } = await Post.findAndCountAll({
      where: { status: 'active' },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role', 'company'] }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });
    res.json({ success: true, data: { posts: rows, total: count } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/posts', authenticate, async (req, res) => {
  if (!Post) return res.status(503).json({ success: false, error: { message: 'Posts not available' } });
  try {
    const { content, title, type, image_url } = req.body;
    const post = await Post.create({
      author_id: req.userId,
      content: content || '',
      title:   title || null,
      type:    type  || 'general',
      image_url: image_url || null,
      status: 'active',
    });
    const full = await Post.findByPk(post.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role', 'company'] }],
    });
    res.status(201).json({ success: true, data: full });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/posts/upload', authenticate, async (req, res) => {
  // Image upload — return placeholder (real upload goes to Cloudinary from frontend)
  res.json({ success: true, data: { url: null } });
});

router.post('/posts/:id/like', authenticate, async (req, res) => {
  if (!Post) return res.json({ success: true });
  try {
    const post = await Post.findByPk(req.params.id);
    if (post) await post.increment('likes_count');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/posts/:id/reactions', authenticate, async (req, res) => {
  res.json({ success: true });
});

router.post('/posts/:id/comments', authenticate, async (req, res) => {
  res.json({ success: true, data: { id: Date.now(), content: req.body.content, author: { id: req.userId } } });
});

router.delete('/posts/:id', authenticate, async (req, res) => {
  if (!Post) return res.json({ success: true });
  try {
    const post = await Post.findByPk(req.params.id);
    if (post && (post.author_id === req.userId || req.userRole === 'admin')) {
      await post.update({ status: 'deleted' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

/* ════════════════════════════════════════════════════════════════════
   MESSAGES
════════════════════════════════════════════════════════════════════ */
router.get('/messages/inbox', authenticate, async (req, res) => {
  if (!Message) return res.json({ success: true, data: { messages: [] } });
  try {
    const msgs = await Message.findAll({
      where: { receiver_id: req.userId },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ success: true, data: { messages: msgs } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/messages', authenticate, async (req, res) => {
  if (!Message) return res.json({ success: true, data: {} });
  try {
    const { receiver_id, content } = req.body;
    const msg = await Message.create({ sender_id: req.userId, receiver_id, content });
    res.status(201).json({ success: true, data: msg });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/messages/typing', authenticate, (req, res) => {
  res.json({ success: true });
});

router.put('/messages/:id/read', authenticate, async (req, res) => {
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════════
   NOTIFICATIONS
════════════════════════════════════════════════════════════════════ */
router.get('/notifications', authenticate, async (req, res) => {
  res.json({ success: true, data: { notifications: [] } });
});

router.put('/notifications/read-all', authenticate, async (req, res) => {
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════════
   LIBRARY
════════════════════════════════════════════════════════════════════ */
let _library = [];

router.get('/library', optionalAuth, async (req, res) => {
  res.json({ success: true, data: { items: _library } });
});

router.post('/library', authenticate, isAdmin, async (req, res) => {
  const item = { id: Date.now(), ...req.body, createdAt: new Date() };
  _library.unshift(item);
  res.status(201).json({ success: true, data: item });
});

/* ════════════════════════════════════════════════════════════════════
   EVENTS
════════════════════════════════════════════════════════════════════ */
let _events = [];

router.get('/events', optionalAuth, async (req, res) => {
  res.json({ success: true, data: { events: _events } });
});

router.post('/events', authenticate, isAdmin, async (req, res) => {
  const ev = { id: Date.now(), ...req.body, rsvps: [], createdAt: new Date() };
  _events.unshift(ev);
  res.status(201).json({ success: true, data: ev });
});

router.post('/events/:id/rsvp', authenticate, async (req, res) => {
  const ev = _events.find(e => String(e.id) === req.params.id);
  if (ev && !ev.rsvps.includes(req.userId)) ev.rsvps.push(req.userId);
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════════
   FOLLOWS
════════════════════════════════════════════════════════════════════ */
let _follows = []; // { follower_id, following_id }

router.get('/follows/following', authenticate, async (req, res) => {
  const ids = _follows.filter(f => f.follower_id === req.userId).map(f => f.following_id);
  res.json({ success: true, data: { following: ids } });
});

router.get('/follows/followers', authenticate, async (req, res) => {
  const ids = _follows.filter(f => f.following_id === req.userId).map(f => f.follower_id);
  res.json({ success: true, data: { followers: ids } });
});

router.post('/follows/:userId', authenticate, async (req, res) => {
  const key = { follower_id: req.userId, following_id: req.params.userId };
  const exists = _follows.find(f => f.follower_id === key.follower_id && f.following_id === key.following_id);
  if (exists) {
    _follows = _follows.filter(f => !(f.follower_id === key.follower_id && f.following_id === key.following_id));
    res.json({ success: true, following: false });
  } else {
    _follows.push(key);
    res.json({ success: true, following: true });
  }
});

/* ════════════════════════════════════════════════════════════════════
   PORTFOLIO
════════════════════════════════════════════════════════════════════ */
router.get('/portfolio', authenticate, async (req, res) => {
  res.json({ success: true, data: { portfolio: [] } });
});

router.post('/portfolio', authenticate, async (req, res) => {
  res.status(201).json({ success: true, data: req.body });
});

/* ════════════════════════════════════════════════════════════════════
   ONLINE PRESENCE
════════════════════════════════════════════════════════════════════ */
router.post('/online/heartbeat', authenticate, async (req, res) => {
  onlineUsers[req.userId] = Date.now();
  res.json({ success: true });
});

router.get('/online/count', optionalAuth, async (req, res) => {
  const now = Date.now();
  const count = Object.values(onlineUsers).filter(t => now - t < ONLINE_TTL).length;
  res.json({ success: true, data: { count } });
});

router.get('/admin/online', authenticate, isAdmin, async (req, res) => {
  const now = Date.now();
  const activeIds = Object.entries(onlineUsers)
    .filter(([, t]) => now - t < ONLINE_TTL)
    .map(([id]) => id);
  res.json({ success: true, data: { count: activeIds.length, userIds: activeIds } });
});

/* ════════════════════════════════════════════════════════════════════
   ANALYTICS
════════════════════════════════════════════════════════════════════ */
router.get('/analytics/me', authenticate, async (req, res) => {
  res.json({ success: true, data: { views: 0, proposals: 0, messages: 0 } });
});

router.get('/analytics/platform', authenticate, isAdmin, async (req, res) => {
  try {
    const totalUsers    = await User.count();
    const totalProjects = await RFP.count();
    res.json({ success: true, data: { totalUsers, totalProjects, activeToday: Object.keys(onlineUsers).length } });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

/* ════════════════════════════════════════════════════════════════════
   REFERRALS
════════════════════════════════════════════════════════════════════ */
router.get('/referrals/stats', authenticate, async (req, res) => {
  res.json({ success: true, data: { referred: 0, earned: 0 } });
});

/* ════════════════════════════════════════════════════════════════════
   RFP EXTRAS
════════════════════════════════════════════════════════════════════ */
router.get('/rfps/my', authenticate, async (req, res) => {
  try {
    const rfps = await RFP.findAll({ where: { client_id: req.userId }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rfps });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/rfps/:id/publish', authenticate, async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    await rfp.update({ status: 'open', published_at: new Date() });
    res.json({ success: true, data: rfp });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/rfps/:id/close', authenticate, async (req, res) => {
  try {
    const rfp = await RFP.findByPk(req.params.id);
    if (!rfp) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    await rfp.update({ status: 'cancelled' });
    res.json({ success: true, data: rfp });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/rfps/:id/proposals', authenticate, async (req, res) => {
  if (!Proposal) return res.status(503).json({ success: false, error: { message: 'Proposals not available' } });
  try {
    const p = await Proposal.create({ rfp_id: req.params.id, professional_id: req.userId, ...req.body });
    res.status(201).json({ success: true, data: p });
  } catch (e) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.get('/rfps/:id/matches', authenticate, async (req, res) => {
  res.json({ success: true, data: { matches: [] } });
});

router.post('/rfps/:id/matches/notify', authenticate, async (req, res) => {
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════════
   ADMIN EXTRAS
════════════════════════════════════════════════════════════════════ */
// Homepage content (for admin.html homepage manager)
router.get('/admin/homepage', authenticate, isAdmin, async (req, res) => {
  res.json({ success: true, data: homepageData });
});

router.post('/admin/homepage', authenticate, isAdmin, async (req, res) => {
  homepageData = { ...homepageData, ...req.body, updatedAt: new Date() };
  res.json({ success: true, data: homepageData });
});

// Public homepage read
router.get('/homepage', async (req, res) => {
  res.json({ success: true, data: homepageData });
});

router.post('/homepage', authenticate, async (req, res) => {
  homepageData = { ...homepageData, ...req.body, updatedAt: new Date() };
  res.json({ success: true, data: homepageData });
});

// Spotlight
router.put('/admin/spotlight', authenticate, isAdmin, async (req, res) => {
  spotlightData = req.body;
  res.json({ success: true, data: spotlightData });
});

router.get('/admin/spotlight', optionalAuth, async (req, res) => {
  res.json({ success: true, data: spotlightData });
});

// Broadcast message to members
router.post('/admin/broadcast', authenticate, isAdmin, async (req, res) => {
  const { subject, body, audience } = req.body;
  // In production this would send emails; for now just acknowledge
  console.log(`📢 Broadcast: [${audience}] ${subject}`);
  res.json({ success: true, message: `Broadcast queued for ${audience} audience` });
});

module.exports = router;
