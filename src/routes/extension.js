/**
 * BuildConnect Pro — src/routes/extension.js
 * ===========================================
 * COMPLETE version — covers every endpoint called by admin + member + home.
 *
 * server.js must mount FIRST:
 *   const ext = require('./routes/extension');
 *   app.use('/api/v1', ext);          ← FIRST, before all other routers
 *   app.use('/api/v1/auth',  authRoutes);
 *   app.use('/api/v1/rfps',  rfpRoutes);
 *   app.use('/api/v1/admin', adminRoutes);
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ─── Auth middleware ────────────────────────────────────────────────
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
  console.warn('[ext] Could not load auth middleware:', e.message);
  protect   = (req, res, next) => next();
  adminOnly = (req, res, next) => next();
}

// ─── Models ────────────────────────────────────────────────────────
let User, Message, Post, Notification, RFP, Proposal;
try { User         = require('../models/User');         } catch(e) {}
try { Message      = require('../models/Message');      } catch(e) {}
try { Post         = require('../models/Post');         } catch(e) {}
try { Notification = require('../models/Notification'); } catch(e) {}
try { RFP          = require('../models/RFP');          } catch(e) {}
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

// Normalise a post object so frontend always sees body + media[]
function normalisePost(p) {
  if (!p) return p;
  const body  = p.body || p.content || p.title || '';
  const media = (p.media && p.media.length) ? p.media
    : (p.images||[]).map(u => typeof u==='string' ? {type:'image',url:u} : u);
  return { ...p, body, media };
}


// ─── In-memory stores (fallback when DB unavailable) ───────────────
const store = {
  messages:[], notifications:[], broadcasts:[],
  online: new Map(),
  posts:[], events:[], library:[], members:[],
  homepageData: {
    showcaseImages:[], howImages:[], featuredProjects:[],
    tickerItems:[], sponsors:[], adBanner:{}
  },
};
let msgId=1, notifId=1, bcId=1, postId=1, eventId=1, libId=1;

// ─── DB helpers ────────────────────────────────────────────────────
async function findUser(id) {
  if (!User || !id) return null;
  try {
    if (isSeq) { const u = await User.findByPk(id); return u?.toJSON?.() ?? u ?? null; }
    if (isMng) return await User.findById(id).lean();
  } catch(e) { return null; }
}

async function findAllUsers(where={}) {
  if (!User) return store.members;
  try {
    if (isSeq) return (await User.findAll({ where })).map(u => u.toJSON?.() ?? u);
    if (isMng) return await User.find(where).lean();
  } catch(e) { return store.members; }
}

async function updateUser(id, data) {
  if (!User || !id) return;
  try {
    if (isSeq) await User.update(data, { where:{ id } });
    if (isMng) await User.findByIdAndUpdate(id, data);
  } catch(e) { console.error('[ext] updateUser:', e.message); }
}

async function saveMessage(data) {
  if (!Message) return null;
  try { const m = await Message.create(data); return m.toJSON?.() ?? m; }
  catch(e) { return null; }
}

async function queryMessages(where) {
  if (!Message) return [];
  try {
    if (isSeq) {
      const { Op } = require('sequelize');
      return (await Message.findAll({
        where, order:[['createdAt','DESC']], limit:200,
        include:[
          { model:User, as:'sender',   attributes:['id','name','email','role'], required:false },
          { model:User, as:'receiver', attributes:['id','name','email','role'], required:false },
        ],
      })).map(r => r.toJSON?.() ?? r);
    }
    if (isMng) return await Message.find(where).sort({ createdAt:-1 }).limit(200)
      .populate('sender receiver','name email role').lean();
  } catch(e) { return []; }
}

async function addNotification(userId, type, title, body='') {
  if (!userId) return;
  const n = { id:String(notifId++), user_id:String(userId), type, title, body, is_read:false, createdAt:new Date() };
  if (Notification) {
    try {
      if (isSeq) { await Notification.create(n); return; }
      if (isMng) { await Notification.create(n); return; }
    } catch(e) {}
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
  const id = uid(req);
  if (id) store.online.set(id, Date.now()); // count caller as online
  ok(res, { count: Math.max(store.online.size, 1) });
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
      if (isSeq) notifs = (await Notification.findAll({
        where:{ user_id:userId }, order:[['createdAt','DESC']], limit:50
      })).map(n => n.toJSON?.() ?? n);
      if (isMng) notifs = await Notification.find({ user_id:userId })
        .sort({ createdAt:-1 }).limit(50).lean();
    } catch(e) {}
  }
  if (!notifs.length) notifs = store.notifications.filter(n => n.user_id===userId);
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

router.post('/messages', protect, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = uid(req);
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');
  const data = { sender_id, receiver_id, subject, body, is_read:false, createdAt:new Date() };
  let msg = await saveMessage(data);
  if (!msg) {
    const s = await findUser(sender_id)   || { name:req.user?.name||'', email:'', role:'' };
    const r = await findUser(receiver_id) || { name:'Member', email:'', role:'' };
    msg = { ...data, id:String(msgId++),
      sender  :{ id:sender_id,   name:s.name, email:s.email||'', role:s.role||'' },
      receiver:{ id:receiver_id, name:r.name, email:r.email||'', role:r.role||'' },
    };
    store.messages.unshift(msg);
  }
  await addNotification(receiver_id, 'message',
    `New message from ${req.user?.name||'a member'}`, subject || String(body).slice(0,80));
  ok(res, { message:msg }, 'Message sent');
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
//  POSTS (feed)
// ═══════════════════════════════════════════════════════════════════

router.get('/posts', protect, wrap(async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 10;
  let posts = [];
  if (Post) {
    try {
      if (isSeq) posts = (await Post.findAll({
        order:[['createdAt','DESC']], limit: Math.min(limit,100), offset:(page-1)*limit,
        include:[{ model:User, as:'author', attributes:['id','name','role','profile_photo'], required:false }]
      })).map(p => p.toJSON?.() ?? p);
      if (isMng) posts = await Post.find({}).sort({ createdAt:-1 })
        .limit(Math.min(limit,100)).skip((page-1)*limit)
        .populate('author','name role profile_photo').lean();
    } catch(e) { console.error('[ext] posts:', e.message); }
  }
  if (!posts.length) posts = store.posts.slice((page-1)*limit, page*limit);
  // Normalise every post so frontend always gets body + media[]
  posts = posts.map(p => {
    const body = p.body || p.content || p.title || '';
    const media = p.media?.length ? p.media
      : (p.images||[]).map(u => typeof u==='string' ? {type:'image',url:u} : u);
    return { ...p, body, media };
  });
  ok(res, { posts, page, limit, total:posts.length });
}));

router.get('/posts/:id', protect, wrap(async (req, res) => {
  let post = null;
  if (Post) {
    try {
      if (isSeq) { const p = await Post.findByPk(req.params.id, {
        include:[{ model:User, as:'author', attributes:['id','name','role'], required:false }]
      }); post = p?.toJSON?.() ?? p; }
      if (isMng) post = await Post.findById(req.params.id).populate('author','name role').lean();
    } catch(e) {}
  }
  if (!post) post = store.posts.find(p => String(p.id)===req.params.id);
  if (!post) return fail(res, 'Post not found', 404);
  ok(res, { post: normalisePost(post) });
}));

router.post('/posts', protect, wrap(async (req, res) => {
  const { title, content, body, type='update', media=[], images=[], tags=[], rfp_id=null } = req.body;
  const text = body || content || title || '';
  if (!text) return fail(res, 'body is required');
  // Normalise media: frontend sends media=[{type:'image',url:'...'}]
  // also accept plain images=[] array for backwards compat
  const normMedia = media.length ? media
    : images.map(u => typeof u==='string' ? { type:'image', url:u } : u);
  const data = {
    body: text,           // ← frontend reads p.body
    content: text,        // ← keep both for DB compat
    title: title || text.slice(0,80),
    media: normMedia,     // ← frontend reads p.media[].url
    images: normMedia.map(m=>m.url||m).filter(Boolean),
    type, tags, rfp_id,
    author_id:uid(req), likes:[], reactions:{}, comments:[],
    createdAt:new Date(), updatedAt:new Date()
  };
  let post = null;
  if (Post) {
    try {
      const p = await Post.create(data);
      post = p.toJSON?.() ?? p;
    } catch(e) { console.error('[ext] createPost:', e.message); }
  }
  if (!post) { post = { ...data, id:String(postId++) }; store.posts.unshift(post); }
  ok(res, { post }, 'Post created');
}));

router.put('/posts/:id', protect, wrap(async (req, res) => {
  if (Post) {
    try {
      if (isSeq) await Post.update({ ...req.body, updatedAt:new Date() }, { where:{ id:req.params.id } });
      if (isMng) await Post.findByIdAndUpdate(req.params.id, req.body);
    } catch(e) { return fail(res, e.message); }
  }
  const p = store.posts.find(p => String(p.id)===req.params.id);
  if (p) Object.assign(p, req.body);
  ok(res, {}, 'Updated');
}));

router.delete('/posts/:id', protect, wrap(async (req, res) => {
  if (Post) {
    try {
      if (isSeq) await Post.destroy({ where:{ id:req.params.id } });
      if (isMng) await Post.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  store.posts = store.posts.filter(p => String(p.id)!==req.params.id);
  ok(res, {}, 'Deleted');
}));

// Post reactions
router.post('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const { emoji='❤️' } = req.body;
  const userId = uid(req);
  if (Post) {
    try {
      if (isSeq) {
        const p = await Post.findByPk(req.params.id);
        if (p) {
          const reactions = p.reactions || {};
          reactions[userId] = emoji;
          await p.update({ reactions });
          return ok(res, { reactions }, 'Reaction saved');
        }
      }
    } catch(e) {}
  }
  // In-memory fallback
  const p = store.posts.find(p => String(p.id)===req.params.id);
  if (p) { p.reactions = p.reactions||{}; p.reactions[userId]=emoji; }
  ok(res, { reactions: p?.reactions||{} }, 'Reaction saved');
}));

router.delete('/posts/:id/reactions', protect, wrap(async (req, res) => {
  const userId = uid(req);
  if (Post) {
    try {
      if (isSeq) {
        const p = await Post.findByPk(req.params.id);
        if (p) {
          const reactions = p.reactions || {};
          delete reactions[userId];
          await p.update({ reactions });
          return ok(res, { reactions }, 'Reaction removed');
        }
      }
    } catch(e) {}
  }
  const p = store.posts.find(p => String(p.id)===req.params.id);
  if (p && p.reactions) delete p.reactions[userId];
  ok(res, {}, 'Reaction removed');
}));

// Post likes (legacy)
router.post('/posts/:id/like', protect, wrap(async (req, res) => {
  const userId = uid(req);
  if (Post) {
    try {
      if (isSeq) {
        const p = await Post.findByPk(req.params.id);
        if (p) {
          const likes = p.likes||[];
          const idx = likes.indexOf(userId);
          if (idx>=0) likes.splice(idx,1); else likes.push(userId);
          await p.update({ likes });
          return ok(res, { likes, liked: idx<0 });
        }
      }
    } catch(e) {}
  }
  const p = store.posts.find(p => String(p.id)===req.params.id);
  if (p) { p.likes=p.likes||[]; const i=p.likes.indexOf(userId); if(i>=0)p.likes.splice(i,1);else p.likes.push(userId); }
  ok(res, { likes: p?.likes||[] });
}));

// Post comments
router.get('/posts/:id/comments', protect, wrap(async (req, res) => {
  const p = store.posts.find(p => String(p.id)===req.params.id);
  ok(res, { comments: p?.comments||[] });
}));

router.post('/posts/:pid/comments', protect, wrap(async (req, res) => {
  const { body, content } = req.body;
  const text = body||content||'';
  if (!text) return fail(res, 'body is required');
  const comment = { id:String(Date.now()), author_id:uid(req), author:{ name:req.user?.name||'Member' },
    body:text, createdAt:new Date() };
  const p = store.posts.find(p => String(p.id)===req.params.pid);
  if (p) { p.comments=p.comments||[]; p.comments.push(comment); }
  ok(res, { comment }, 'Comment added');
}));

// ═══════════════════════════════════════════════════════════════════
//  MEMBERS
// ═══════════════════════════════════════════════════════════════════

router.get('/members', protect, wrap(async (req, res) => {
  const users = await findAllUsers({ is_active:true });
  ok(res, { members:users, users });
}));

router.get('/members/:id/portfolio', protect, wrap(async (req, res) => {
  // Portfolio items stored on user object or separate collection
  const user = await findUser(req.params.id);
  const portfolio = user?.portfolio || [];
  ok(res, { portfolio, items:portfolio });
}));

// ═══════════════════════════════════════════════════════════════════
//  FOLLOWS
// ═══════════════════════════════════════════════════════════════════

// In-memory follow store
const follows = new Map(); // userId -> Set of followingIds

router.get('/follows/following', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const following = [...(follows.get(userId)||new Set())];
  ok(res, { following });
}));

router.get('/follows/followers', protect, wrap(async (req, res) => {
  const userId = uid(req);
  const followers = [];
  for (const [fId, set] of follows) {
    if (set.has(userId)) followers.push(fId);
  }
  ok(res, { followers });
}));

router.post('/follows/:userId', protect, wrap(async (req, res) => {
  const me = uid(req);
  const target = req.params.userId;
  if (!follows.has(me)) follows.set(me, new Set());
  follows.get(me).add(target);
  ok(res, { following:true }, 'Followed');
}));

router.delete('/follows/:userId', protect, wrap(async (req, res) => {
  const me = uid(req);
  follows.get(me)?.delete(req.params.userId);
  ok(res, { following:false }, 'Unfollowed');
}));

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

router.get('/events', protect, wrap(async (req, res) => {
  ok(res, { events: store.events });
}));

router.post('/events', protect, adminOnly, wrap(async (req, res) => {
  const { title, date, time='', location='', type='Networking', description='' } = req.body;
  if (!title || !date) return fail(res, 'title and date are required');
  const event = { id:String(eventId++), title, date, time, location, type,
    description, rsvps:[], createdAt:new Date() };
  store.events.unshift(event);
  ok(res, { event }, 'Event created');
}));

router.put('/events/:id', protect, adminOnly, wrap(async (req, res) => {
  const event = store.events.find(e => String(e.id)===req.params.id);
  if (!event) return fail(res, 'Event not found', 404);
  Object.assign(event, req.body, { updatedAt:new Date() });
  ok(res, { event }, 'Updated');
}));

router.delete('/events/:id', protect, adminOnly, wrap(async (req, res) => {
  store.events = store.events.filter(e => String(e.id)!==req.params.id);
  ok(res, {}, 'Deleted');
}));

router.post('/events/:id/rsvp', protect, wrap(async (req, res) => {
  const event = store.events.find(e => String(e.id)===req.params.id);
  if (event) {
    event.rsvps = event.rsvps||[];
    const userId = uid(req);
    if (!event.rsvps.includes(userId)) event.rsvps.push(userId);
  }
  ok(res, {}, 'RSVP confirmed');
}));

// ═══════════════════════════════════════════════════════════════════
//  LIBRARY
// ═══════════════════════════════════════════════════════════════════

router.get('/library', protect, wrap(async (req, res) => {
  ok(res, { items: store.library, library: store.library });
}));

router.post('/library', protect, adminOnly, wrap(async (req, res) => {
  const { title, type='document', url, description='' } = req.body;
  if (!title) return fail(res, 'title is required');
  const item = { id:String(libId++), title, type, url, description, createdAt:new Date() };
  store.library.unshift(item);
  ok(res, { item }, 'Added to library');
}));

router.delete('/library/:id', protect, adminOnly, wrap(async (req, res) => {
  store.library = store.library.filter(i => String(i.id)!==req.params.id);
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  HOMEPAGE CONTENT  (read by home.html, written by admin)
// ═══════════════════════════════════════════════════════════════════

// Public read — no auth needed so home.html can read it
router.get('/homepage', (req, res) => {
  ok(res, store.homepageData);
});

// Admin write
router.post('/homepage', protect, adminOnly, wrap(async (req, res) => {
  Object.assign(store.homepageData, req.body);
  ok(res, store.homepageData, 'Homepage updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — HOMEPAGE  (same store, admin-prefixed for compatibility)
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/homepage', protect, adminOnly, wrap(async (req, res) => {
  ok(res, store.homepageData);
}));

router.post('/admin/homepage', protect, adminOnly, wrap(async (req, res) => {
  Object.assign(store.homepageData, req.body);
  ok(res, store.homepageData, 'Homepage updated');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — STATS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/stats', protect, adminOnly, wrap(async (req, res) => {
  const users = await findAllUsers();
  const cut   = Date.now() - 120000;
  for (const [k,t] of store.online) { if (t < cut) store.online.delete(k); }
  const monthly = users.filter(u => u.subscription_tier==='monthly' && u.subscription_status==='active').length;
  const annual  = users.filter(u => u.subscription_tier==='annual'  && u.subscription_status==='active').length;
  ok(res, {
    total_users  : users.length,
    active_users : users.filter(u => u.is_active!==false).length,
    online_now   : store.online.size,
    monthly_revenue : monthly*49 + annual*39,
    annual_revenue  : (monthly*49 + annual*39)*12,
    total_rfps   : store.events.length,  // rfps counted separately
    open_rfps    : 0,
    total_posts  : store.posts.length,
    total_messages: store.messages.length,
  });
}));

router.get('/admin/stats-extended', protect, adminOnly, wrap(async (req, res) => {
  const users   = await findAllUsers();
  const monthly = users.filter(u => u.subscription_tier==='monthly' && u.subscription_status==='active').length;
  const annual  = users.filter(u => u.subscription_tier==='annual'  && u.subscription_status==='active').length;
  const cut = Date.now() - 120000;
  for (const [k,t] of store.online) { if (t < cut) store.online.delete(k); }
  ok(res, {
    users        : users.length,
    online       : store.online.size,
    monthly_subs : monthly,
    annual_subs  : annual,
    free_users   : users.filter(u => !u.subscription_tier||u.subscription_tier==='free').length,
    mrr          : monthly*49 + annual*39,
    arr          : (monthly*49 + annual*39)*12,
    messages     : store.messages.length,
    broadcasts   : store.broadcasts.length,
    posts        : store.posts.length,
    open_rfps    : 0,
  });
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — USERS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/users', protect, adminOnly, wrap(async (req, res) => {
  const users = await findAllUsers();
  ok(res, { users, members:users });
}));

router.get('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return fail(res, 'User not found', 404);
  ok(res, { user });
}));

router.put('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
  await updateUser(req.params.id, req.body);
  const user = await findUser(req.params.id);
  ok(res, { user }, 'Updated');
}));

router.put('/admin/users/:id/subscription', protect, adminOnly, wrap(async (req, res) => {
  const { tier, status='active', end_date, note } = req.body;
  const userId = req.params.id;
  let subEnd = end_date ? new Date(end_date) : null;
  await updateUser(userId, {
    subscription_tier:tier||'free', subscription_status:status,
    subscription_end:subEnd, updated_at:new Date(),
  });
  const labels = { monthly:'Monthly Pro', annual:'Annual Pro', free:'Free' };
  let msg = `Your plan has been updated to ${labels[tier]||tier}`;
  if (subEnd) {
    const perm = subEnd.getFullYear() >= 2099;
    msg += perm ? ' — permanent access!' : ` — valid until ${subEnd.toLocaleDateString('en-GB')}`;
  }
  await addNotification(userId, 'system', msg, note||'');
  const updated = await findUser(userId) || { id:userId, subscription_tier:tier, subscription_status:status };
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
//  ADMIN — PROJECTS / RFPs
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/projects', protect, adminOnly, wrap(async (req, res) => {
  let rfps = [];
  if (RFP) {
    try {
      if (isSeq) rfps = (await RFP.findAll({
        order:[['createdAt','DESC']],
        include:[{ model:User, as:'client', attributes:['id','name','email'], required:false }]
      })).map(r => r.toJSON?.() ?? r);
      if (isMng) rfps = await RFP.find({}).sort({ createdAt:-1 })
        .populate('client','name email').lean();
    } catch(e) { console.error('[ext] admin/projects:', e.message); }
  }
  ok(res, { projects:rfps, rfps });
}));

router.get('/admin/projects/:id', protect, adminOnly, wrap(async (req, res) => {
  let rfp = null;
  if (RFP) {
    try {
      if (isSeq) { const r = await RFP.findByPk(req.params.id); rfp = r?.toJSON?.() ?? r; }
      if (isMng) rfp = await RFP.findById(req.params.id).lean();
    } catch(e) {}
  }
  if (!rfp) return fail(res, 'Project not found', 404);
  ok(res, { project:rfp, rfp });
}));

router.put('/admin/projects/:id', protect, adminOnly, wrap(async (req, res) => {
  if (RFP) {
    try {
      if (isSeq) await RFP.update(req.body, { where:{ id:req.params.id } });
      if (isMng) await RFP.findByIdAndUpdate(req.params.id, req.body);
    } catch(e) { return fail(res, e.message); }
  }
  ok(res, {}, 'Updated');
}));

router.put('/admin/projects/:id/status', protect, adminOnly, wrap(async (req, res) => {
  const { status } = req.body;
  if (RFP) {
    try {
      if (isSeq) await RFP.update({ status }, { where:{ id:req.params.id } });
      if (isMng) await RFP.findByIdAndUpdate(req.params.id, { status });
    } catch(e) { return fail(res, e.message); }
  }
  ok(res, {}, 'Status updated');
}));

router.delete('/admin/projects/:id', protect, adminOnly, wrap(async (req, res) => {
  if (RFP) {
    try {
      if (isSeq) await RFP.destroy({ where:{ id:req.params.id } });
      if (isMng) await RFP.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — POSTS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
  let posts = [];
  if (Post) {
    try {
      if (isSeq) posts = (await Post.findAll({ order:[['createdAt','DESC']], limit:100,
        include:[{ model:User, as:'author', attributes:['id','name','role'], required:false }]
      })).map(p => p.toJSON?.() ?? p);
      if (isMng) posts = await Post.find({}).sort({ createdAt:-1 }).limit(100)
        .populate('author','name role').lean();
    } catch(e) {}
  }
  if (!posts.length) posts = store.posts;
  ok(res, { posts: posts.map(normalisePost) });
}));

router.put('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Post) {
    try {
      if (isSeq) await Post.update(req.body, { where:{ id:req.params.id } });
      if (isMng) await Post.findByIdAndUpdate(req.params.id, req.body);
    } catch(e) { return fail(res, e.message); }
  }
  const p = store.posts.find(p => String(p.id)===req.params.id);
  if (p) Object.assign(p, req.body);
  ok(res, {}, 'Updated');
}));

router.delete('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
  if (Post) {
    try {
      if (isSeq) await Post.destroy({ where:{ id:req.params.id } });
      if (isMng) await Post.deleteOne({ _id:req.params.id });
    } catch(e) {}
  }
  store.posts = store.posts.filter(p => String(p.id)!==req.params.id);
  ok(res, {}, 'Deleted');
}));

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — MESSAGES
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  const msgs = Message ? await queryMessages({}) : [...store.messages];
  ok(res, { messages:msgs });
}));

router.post('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
  const { receiver_id, subject='', body } = req.body;
  const sender_id = uid(req);
  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');
  const data = { sender_id, receiver_id, subject, body, is_read:false, createdAt:new Date() };
  let msg = await saveMessage(data);
  if (!msg) {
    const r = await findUser(receiver_id) || { name:'Member', email:'', role:'' };
    msg = { ...data, id:String(msgId++),
      sender  :{ id:sender_id, name:req.user?.name||'Admin', email:'', role:'admin' },
      receiver:{ id:receiver_id, name:r.name, email:r.email||'', role:r.role||'' },
    };
    store.messages.unshift(msg);
  }
  await addNotification(receiver_id, 'message',
    `Message from Admin${subject ? ': '+subject : ''}`, String(body).slice(0,100));
  ok(res, { message:msg }, 'Sent');
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
//  ADMIN — BROADCAST
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
      subject:`[Broadcast] ${title}`, body:body||title,
      is_read:false, createdAt:new Date() };
    const saved = await saveMessage(data);
    if (!saved) store.messages.unshift({ ...data, id:String(msgId++),
      sender  :{ id:sender_id, name:req.user?.name||'Admin', role:'admin' },
      receiver:{ id:receiverId, name:u.name||'Member' },
    });
    sent++;
  }
  const bc = { id:String(bcId++), title, body, type, sent, createdAt:new Date() };
  store.broadcasts.unshift(bc);
  ok(res, { broadcast:bc, sent }, `Broadcast sent to ${sent} members`);
}));

// ═══════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════

router.use((error, req, res, next) => {
  console.error('[ext error]', error.message);
  res.status(error.status||500).json({
    status : 'error',
    error  : { message: error.message || 'Internal server error' },
  });
});

module.exports = router;
