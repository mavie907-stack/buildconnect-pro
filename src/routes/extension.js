/**
2 * BuildConnect Pro — src/routes/extension.js
3 * ============================================
4 * Handles all dashboard routes: posts, rfps, messages,
5 * notifications, online presence, members, profile update,
6 * media upload, and admin actions.
7 *
8 * Save this file as:  src/routes/extension.js
9 */
10
11'use strict';
12
13const express    = require('express');
14const router     = express.Router();
15const { Op }     = require('sequelize');
16const sequelize  = require('../config/database');
17let Anthropic;
18try { Anthropic = require('@anthropic-ai/sdk'); } catch(e) {}
19
20// ─── Auth middleware (matches this project's exports) ──────────────
21const { authenticate, authorize } = require('../middleware/auth');
22const protect    = authenticate;
23const adminOnly  = authorize('admin');
24
25// ─── Core models ───────────────────────────────────────────────────
26const User = require('../models/User');
27const RFP  = require('../models/RFP');
28
29// ─── Optional models (created automatically if missing) ────────────
30let Post, Message, Notification, Proposal, LibraryFile, Portfolio, Review;
31try { Post         = require('../models/Post');         } catch(e) {}
32try { Message      = require('../models/Message');      } catch(e) {}
33try { Notification = require('../models/Notification'); } catch(e) {}
34try { Proposal     = require('../models/Proposal');     } catch(e) {}
35try { LibraryFile  = require('../models/LibraryFile');  } catch(e) {}
36try { Portfolio    = require('../models/Portfolio');    } catch(e) {}
37try { Review       = require('../models/Review');       } catch(e) {}
38
39// ─── Cloudinary image uploads ─────────────────────────────────────
40let cloudinary = null;
41let multer     = null;
42let upload     = null;
43try {
44  cloudinary = require('cloudinary').v2;
45  cloudinary.config({
46    cloud_name : process.env.CLOUDINARY_CLOUD_NAME || 'dgxk9xgmh',
47    api_key    : process.env.CLOUDINARY_API_KEY    || '152912546379282',
48    api_secret : process.env.CLOUDINARY_API_SECRET || 'Nvnb7AhYoHsI2ZK0N7Fbcg1oODU',
49  });
50  // Use multer memoryStorage — files go to Cloudinary, not disk
51  multer = require('multer');
52  upload = multer({
53    storage : multer.memoryStorage(),
54    limits  : { fileSize: 8 * 1024 * 1024 }, // 8 MB
55  });
56  console.log('[ext] Cloudinary image uploads ready ✅');
57} catch(e) {
58  console.warn('[ext] Cloudinary/multer not installed. Run: npm install cloudinary multer');
59}
60
61// Helper: upload a single buffer to Cloudinary
62function uploadToCloudinary(buffer, mimetype, folder = 'buildconnect') {
63  return new Promise((resolve, reject) => {
64    const stream = cloudinary.uploader.upload_stream(
65      { folder, resource_type: 'auto' },
66      (err, result) => err ? reject(err) : resolve(result)
67    );
68    stream.end(buffer);
69  });
70}
71
72// ─── Response helpers ──────────────────────────────────────────────
73const ok   = (res, data = {}, msg = 'Success') =>
74  res.json({ status: 'success', message: msg, data });
75const fail = (res, msg = 'Error', code = 400) =>
76  res.status(code).json({ status: 'error', error: { message: msg } });
77const wrap = fn => (req, res, next) =>
78  Promise.resolve(fn(req, res, next)).catch(next);
79const uid  = req => req.user?.id || req.userId || '';
80
81// ─── In-memory fallbacks (used when optional models don't exist) ───
82const mem = {
83  posts         : [],
84  messages      : [],
85  notifications : [],
86  proposals     : [],
87  library       : [],
88  online        : new Map(),
89};
90let _pid=1, _mid=1, _nid=1, _boid=1, _lid=1;
91
92// ─── Helper: safe user lookup ──────────────────────────────────────
93async function getUser(id) {
94  if (!id) return null;
95  try { return (await User.findByPk(id))?.toJSON() || null; } catch(e) { return null; }
96}
97async function getAllUsers() {
98  try { return (await User.findAll({ where: { is_active: true } })).map(u => u.toJSON()); }
99  catch(e) { return []; }
100}
101
102// ─── Helper: push a notification ──────────────────────────────────
103async function pushNotif(userId, type, title, body = '') {
104  const data = { id: String(_nid++), user_id: String(userId), type, title, body, is_read: false, createdAt: new Date() };
105  if (Notification) {
106    try { await Notification.create(data); return; } catch(e) {}
107  }
108  mem.notifications.unshift(data);
109}
110
111// ═══════════════════════════════════════════════════════════════════
112//  ONLINE PRESENCE
113// ═══════════════════════════════════════════════════════════════════
114
115router.post('/online/heartbeat', protect, wrap(async (req, res) => {
116  const id = String(uid(req));
117  if (id) mem.online.set(id, Date.now());
118  ok(res, { ok: true });
119}));
120
121router.get('/online/count', protect, wrap(async (req, res) => {
122  const cut = Date.now() - 120000;
123  for (const [k, t] of mem.online) { if (t < cut) mem.online.delete(k); }
124  ok(res, { count: mem.online.size });
125}));
126
127router.get('/admin/online', protect, adminOnly, wrap(async (req, res) => {
128  const cut = Date.now() - 120000;
129  const sessions = [];
130  for (const [userId, ts] of mem.online) {
131    if (ts < cut) { mem.online.delete(userId); continue; }
132    const u = await getUser(userId);
133    sessions.push({ user_id: userId, last_seen: new Date(ts),
134      user: u ? { id: userId, name: u.name, role: u.role } : { id: userId } });
135  }
136  ok(res, { sessions, count: sessions.length });
137}));
138
139// ═══════════════════════════════════════════════════════════════════
140//  PROFILE UPDATE
141//  Dashboard calls PUT /auth/updateMe (falls back to PUT /auth/me)
142// ═══════════════════════════════════════════════════════════════════
143
144async function handleProfileUpdate(req, res) {
145  const userId = uid(req);
146  const { name, company, location, bio } = req.body;
147  const updates = {};
148  if (name     !== undefined) updates.name     = name;
149  if (company  !== undefined) updates.company  = company;
150  if (location !== undefined) updates.location = location;
151  if (bio      !== undefined) updates.bio      = bio;
152
153  try {
154    await User.update(updates, { where: { id: userId } });
155    const updated = await User.findByPk(userId);
156    ok(res, { user: updated ? updated.toPublicJSON() : { id: userId, ...updates } }, 'Profile updated');
157  } catch(e) {
158    fail(res, e.message || 'Update failed');
159  }
160}
161
162router.put('/auth/updateMe', protect, wrap(handleProfileUpdate));
163router.put('/auth/me',       protect, wrap(handleProfileUpdate));
164router.patch('/auth/me',     protect, wrap(handleProfileUpdate));
165
166// ═══════════════════════════════════════════════════════════════════
167//  NOTIFICATIONS
168// ═══════════════════════════════════════════════════════════════════
169
170router.get('/notifications', protect, wrap(async (req, res) => {
171  const userId = String(uid(req));
172  let notifs = [];
173  if (Notification) {
174    try {
175      notifs = (await Notification.findAll({
176        where: { user_id: userId },
177        order: [['createdAt', 'DESC']],
178        limit: 50,
179      })).map(n => n.toJSON());
180    } catch(e) { notifs = mem.notifications.filter(n => n.user_id === userId); }
181  } else {
182    notifs = mem.notifications.filter(n => n.user_id === userId);
183  }
184  ok(res, { notifications: notifs, unread: notifs.filter(n => !n.is_read).length });
185}));
186
187router.put('/notifications/read-all', protect, wrap(async (req, res) => {
188  const userId = String(uid(req));
189  if (Notification) {
190    try { await Notification.update({ is_read: true }, { where: { user_id: userId } }); }
191    catch(e) {}
192  }
193  mem.notifications.filter(n => n.user_id === userId).forEach(n => { n.is_read = true; });
194  ok(res, {}, 'All read');
195}));
196
197// ═══════════════════════════════════════════════════════════════════
198//  MESSAGES
199// ═══════════════════════════════════════════════════════════════════
200
201router.post('/messages', protect, wrap(async (req, res) => {
202  const { receiver_id, subject = '', body } = req.body;
203  const sender_id = String(uid(req));
204  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');
205
206  const data = { sender_id, receiver_id, subject, body, is_read: false, createdAt: new Date() };
207  let msg = null;
208  if (Message) {
209    try { msg = (await Message.create(data)).toJSON(); } catch(e) {}
210  }
211  if (!msg) {
212    const sender   = await getUser(sender_id)   || { id: sender_id,   name: req.user?.name || '', role: '' };
213    const receiver = await getUser(receiver_id) || { id: receiver_id, name: 'Member', role: '' };
214    msg = { ...data, id: String(_mid++), sender, receiver };
215    mem.messages.unshift(msg);
216  }
217  await pushNotif(receiver_id, 'message',
218    `New message from ${req.user?.name || 'a member'}`, subject || String(body).slice(0, 80));
219  ok(res, { message: msg }, 'Message sent');
220}));
221
222router.get('/messages/inbox', protect, wrap(async (req, res) => {
223  const userId = String(uid(req));
224  let msgs = [];
225  if (Message) {
226    try {
227      msgs = (await Message.findAll({
228        where: { [Op.or]: [{ sender_id: userId }, { receiver_id: userId }] },
229        order: [['createdAt', 'DESC']],
230        limit: 200,
231        include: [
232          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
233          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
234        ],
235      })).map(m => m.toJSON());
236    } catch(e) { msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId); }
237  } else {
238    msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId);
239  }
240  ok(res, { messages: msgs });
241}));
242
243router.get('/messages', protect, wrap(async (req, res) => {
244  const userId = String(uid(req));
245  let msgs = [];
246  if (Message) {
247    try {
248      msgs = (await Message.findAll({
249        where: { [Op.or]: [{ sender_id: userId }, { receiver_id: userId }] },
250        order: [['createdAt', 'DESC']],
251        limit: 200,
252        include: [
253          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
254          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
255        ],
256      })).map(m => m.toJSON());
257    } catch(e) { msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId); }
258  } else {
259    msgs = mem.messages.filter(m => m.sender_id === userId || m.receiver_id === userId);
260  }
261  ok(res, { messages: msgs });
262}));
263
264router.put('/messages/:id/read', protect, wrap(async (req, res) => {
265  const userId = String(uid(req));
266  if (Message) {
267    try { await Message.update({ is_read: true }, { where: { id: req.params.id, receiver_id: userId } }); }
268    catch(e) {}
269  }
270  const m = mem.messages.find(m => m.id === req.params.id);
271  if (m) m.is_read = true;
272  ok(res, {}, 'Read');
273}));
274
275router.delete('/messages/:id', protect, wrap(async (req, res) => {
276  if (Message) {
277    try { await Message.destroy({ where: { id: req.params.id } }); } catch(e) {}
278  }
279  mem.messages = mem.messages.filter(m => m.id !== req.params.id);
280  ok(res, {}, 'Deleted');
281}));
282
283// ─── Admin messages ────────────────────────────────────────────────
284
285router.get('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
286  let msgs = [];
287  if (Message) {
288    try {
289      msgs = (await Message.findAll({
290        order: [['createdAt', 'DESC']], limit: 200,
291        include: [
292          { model: User, as: 'sender',   attributes: ['id','name','email','role'], required: false },
293          { model: User, as: 'receiver', attributes: ['id','name','email','role'], required: false },
294        ],
295      })).map(m => m.toJSON());
296    } catch(e) { msgs = [...mem.messages]; }
297  } else { msgs = [...mem.messages]; }
298  ok(res, { messages: msgs });
299}));
300
301router.post('/admin/messages', protect, adminOnly, wrap(async (req, res) => {
302  const { receiver_id, subject = '', body } = req.body;
303  const sender_id = String(uid(req));
304  if (!receiver_id || !body) return fail(res, 'receiver_id and body are required');
305  const data = { sender_id, receiver_id, subject, body, is_read: false, createdAt: new Date() };
306  let msg = null;
307  if (Message) { try { msg = (await Message.create(data)).toJSON(); } catch(e) {} }
308  if (!msg) {
309    const r = await getUser(receiver_id) || { id: receiver_id, name: 'Member', email: '', role: '' };
310    msg = { ...data, id: String(_mid++),
311      sender:   { id: sender_id,   name: req.user?.name || 'Admin', role: 'admin' },
312      receiver: { id: receiver_id, name: r.name, email: r.email || '', role: r.role || '' },
313    };
314    mem.messages.unshift(msg);
315  }
316  await pushNotif(receiver_id, 'message',
317    `Message from Admin${subject ? ': ' + subject : ''}`, String(body).slice(0, 100));
318  ok(res, { message: msg }, 'Message sent');
319}));
320
321router.delete('/admin/messages/:id', protect, adminOnly, wrap(async (req, res) => {
322  if (Message) { try { await Message.destroy({ where: { id: req.params.id } }); } catch(e) {} }
323  mem.messages = mem.messages.filter(m => m.id !== req.params.id);
324  ok(res, {}, 'Deleted');
325}));
326
327// ─── Broadcast ────────────────────────────────────────────────────
328
329router.post('/admin/broadcast', protect, adminOnly, wrap(async (req, res) => {
330  const { title, body = '', type = 'info' } = req.body;
331  if (!title) return fail(res, 'title is required');
332  const sender_id = String(uid(req));
333  const users     = await getAllUsers();
334  let sent        = 0;
335  for (const u of users) {
336    const receiverId = String(u.id);
337    await pushNotif(receiverId, 'system', title, body);
338    const data = { sender_id, receiver_id: receiverId,
339      subject: `[Broadcast] ${title}`, body: body || title, is_read: false, createdAt: new Date() };
340    let saved = false;
341    if (Message) { try { await Message.create(data); saved = true; } catch(e) {} }
342    if (!saved) {
343      mem.messages.unshift({ ...data, id: String(_mid++),
344        sender:   { id: sender_id,   name: req.user?.name || 'Admin', role: 'admin' },
345        receiver: { id: receiverId,  name: u.name || 'Member' },
346      });
347    }
348    sent++;
349  }
350  ok(res, { sent }, `Broadcast sent to ${sent} members`);
351}));
352
353// ═══════════════════════════════════════════════════════════════════
354//  POSTS  (community feed)
355//  NOTE: /posts/upload MUST be registered before /posts/:id
356// ═══════════════════════════════════════════════════════════════════
357
358// ── Media upload → Cloudinary ─────────────────────────────────────
359router.post('/posts/upload', protect, (req, res, next) => {
360  if (!upload) return ok(res, { files: [] }, 'Image uploads disabled — run: npm install cloudinary multer');
361  upload.array('files', 10)(req, res, err => {
362    if (err) return fail(res, err.message || 'Upload error', 400);
363    next();
364  });
365}, wrap(async (req, res) => {
366  const files = req.files || [];
367  if (!files.length) return ok(res, { files: [] }, 'No files received');
368
369  // Upload each file to Cloudinary
370  const result = await Promise.all(files.map(async f => {
371    try {
372      const cld = await uploadToCloudinary(f.buffer, f.mimetype);
373      return {
374        type   : f.mimetype.startsWith('image/') ? 'image' : 'file',
375        url    : cld.secure_url,   // permanent Cloudinary HTTPS URL
376        name   : f.originalname,
377        public_id : cld.public_id,
378      };
379    } catch(e) {
380      console.error('[ext] Cloudinary upload error:', e.message);
381      return null;
382    }
383  }));
384
385  const uploaded = result.filter(Boolean);
386  ok(res, { files: uploaded }, `${uploaded.length} file(s) uploaded`);
387}));
388
389// ── GET paginated feed ────────────────────────────────────────────
390router.get('/posts', protect, wrap(async (req, res) => {
391  const page  = Math.max(1, parseInt(req.query.page)  || 1);
392  const limit = Math.min(50, parseInt(req.query.limit) || 10);
393  const offset = (page - 1) * limit;
394  let posts = [];
395  if (Post) {
396    try {
397      posts = (await Post.findAll({
398        order   : [['createdAt', 'DESC']],
399        limit, offset,
400        include : [{ model: User, as: 'author', attributes: ['id','name','email','role','company','subscription_tier'], required: false }],
401      })).map(p => p.toJSON());
402    } catch(e) { posts = mem.posts.slice(offset, offset + limit); }
403  } else { posts = mem.posts.slice(offset, offset + limit); }
404  ok(res, { posts, page, limit });
405}));
406
407// ── CREATE post ───────────────────────────────────────────────────
408router.post('/posts', protect, wrap(async (req, res) => {
409  const author_id = String(uid(req));
410  const { body, rfp_id, media } = req.body;
411  if (!body) return fail(res, 'body is required');
412  const data = { author_id, body, rfp_id: rfp_id || null,
413    media: media || [], likes: [], comments: [], is_pinned: false, createdAt: new Date() };
414  let post = null;
415  if (Post) {
416    try { post = (await Post.create(data)).toJSON(); } catch(e) {}
417  }
418  if (!post) {
419    post = { ...data, id: String(_pid++) };
420    mem.posts.unshift(post);
421  }
422  const author = await getUser(author_id);
423  if (author) post.author = { id: author_id, name: author.name, email: author.email, role: author.role, company: author.company || '', subscription_tier: author.subscription_tier || 'free' };
424  ok(res, { post }, 'Post created');
425}));
426
427// ── LIKE / unlike ─────────────────────────────────────────────────
428router.post('/posts/:id/like', protect, wrap(async (req, res) => {
429  const userId = String(uid(req));
430  let post = null;
431  if (Post) { try { post = (await Post.findByPk(req.params.id))?.toJSON() || null; } catch(e) {} }
432  if (!post) post = mem.posts.find(p => p.id === req.params.id);
433  if (!post) return fail(res, 'Post not found', 404);
434  const likes    = (Array.isArray(post.likes) ? post.likes : []).map(String);
435  const liked    = likes.includes(userId);
436  const newLikes = liked ? likes.filter(id => id !== userId) : [...likes, userId];
437  if (Post) { try { await Post.update({ likes: newLikes }, { where: { id: req.params.id } }); } catch(e) {} }
438  const mp = mem.posts.find(p => p.id === req.params.id);
439  if (mp) mp.likes = newLikes;
440  ok(res, { liked: !liked, likes: newLikes });
441}));
442
443// ── ADD comment ───────────────────────────────────────────────────
444router.post('/posts/:id/comments', protect, wrap(async (req, res) => {
445  const userId = String(uid(req));
446  const { body } = req.body;
447  if (!body) return fail(res, 'body is required');
448  const author  = await getUser(userId) || { id: userId, name: req.user?.name || 'Member', role: req.user?.role || '' };
449  const comment = { id: String(Date.now()), author: { id: userId, name: author.name, role: author.role }, body, createdAt: new Date() };
450  if (Post) {
451    try {
452      const p = await Post.findByPk(req.params.id);
453      if (p) {
454        const comments = [...(p.comments || []), comment];
455        await Post.update({ comments }, { where: { id: req.params.id } });
456      }
457    } catch(e) {}
458  }
459  const mp = mem.posts.find(p => p.id === req.params.id);
460  if (mp) mp.comments = [...(mp.comments || []), comment];
461  ok(res, { comment }, 'Comment added');
462}));
463
464// ── DELETE post ───────────────────────────────────────────────────
465router.delete('/posts/:id', protect, wrap(async (req, res) => {
466  const userId = String(uid(req));
467  let post = null;
468  if (Post) { try { post = (await Post.findByPk(req.params.id))?.toJSON() || null; } catch(e) {} }
469  if (!post) post = mem.posts.find(p => p.id === req.params.id);
470  if (!post) return fail(res, 'Post not found', 404);
471  if (String(post.author_id) !== userId && req.user?.role !== 'admin')
472    return fail(res, 'Not authorised', 403);
473  if (Post) { try { await Post.destroy({ where: { id: req.params.id } }); } catch(e) {} }
474  mem.posts = mem.posts.filter(p => p.id !== req.params.id);
475  ok(res, {}, 'Post deleted');
476}));
477
478// ── Admin posts ───────────────────────────────────────────────────
479router.get('/admin/posts', protect, adminOnly, wrap(async (req, res) => {
480  let posts = [];
481  if (Post) {
482    try {
483      posts = (await Post.findAll({
484        order: [['createdAt', 'DESC']], limit: 100,
485        include: [{ model: User, as: 'author', attributes: ['id','name','role'], required: false }],
486      })).map(p => p.toJSON());
487    } catch(e) { posts = [...mem.posts]; }
488  } else { posts = [...mem.posts]; }
489  ok(res, { posts });
490}));
491
492router.put('/admin/posts/:id', protect, adminOnly, wrap(async (req, res) => {
493  if (Post) { try { await Post.update(req.body, { where: { id: req.params.id } }); } catch(e) { return fail(res, e.message); } }
494  const mp = mem.posts.find(p => p.id === req.params.id);
495  if (mp) Object.assign(mp, req.body);
496  ok(res, {}, 'Updated');
497}));
498
499// ═══════════════════════════════════════════════════════════════════
500//  RFPs
501//  ⚠️  /rfps/my  MUST come before  /rfps/:id  (Express route order)
502// ═══════════════════════════════════════════════════════════════════
503
504// ── GET all open RFPs (professionals browsing) ────────────────────
505router.get('/rfps', protect, wrap(async (req, res) => {
506  const page   = Math.max(1, parseInt(req.query.page)  || 1);
507  const limit  = Math.min(50, parseInt(req.query.limit) || 20);
508  const offset = (page - 1) * limit;
509  try {
510    const rfps = (await RFP.findAll({
511      where   : { status: 'open' },
512      order   : [['createdAt', 'DESC']],
513      limit, offset,
514      include : [{ model: User, as: 'client', attributes: ['id','name','company','role'], required: false }],
515    })).map(r => r.toJSON());
516    ok(res, { rfps, page, limit });
517  } catch(e) { fail(res, e.message); }
518}));
519
520// ── GET my RFPs (clients) — MUST be before /:id ───────────────────
521router.get('/rfps/my', protect, wrap(async (req, res) => {
522  const userId = uid(req);
523  try {
524    const rfps = (await RFP.findAll({
525      where : { client_id: userId },
526      order : [['createdAt', 'DESC']],
527      include: [{ model: User, as: 'client', attributes: ['id','name','company'], required: false }],
528    })).map(r => r.toJSON());
529    ok(res, { rfps });
530  } catch(e) { fail(res, e.message); }
531}));
532
533// ── GET single RFP ────────────────────────────────────────────────
534router.get('/rfps/:id', protect, wrap(async (req, res) => {
535  try {
536    const rfp = await RFP.findByPk(req.params.id, {
537      include: [{ model: User, as: 'client', attributes: ['id','name','company','role'], required: false }],
538    });
539    if (!rfp) return fail(res, 'RFP not found', 404);
540    // Increment view count
541    await rfp.increment('view_count').catch(() => {});
542    ok(res, { rfp: rfp.toJSON() });
543  } catch(e) { fail(res, e.message); }
544}));
545
546// ── CREATE RFP ────────────────────────────────────────────────────
547router.post('/rfps', protect, wrap(async (req, res) => {
548  const userId = uid(req);
549  const { title, description, project_type, proposal_deadline,
550          budget_min, budget_max, currency = 'USD',
551          privacy_level = 'public', status = 'draft', location, industry } = req.body;
552  if (!title)             return fail(res, 'title is required');
553  if (!description)       return fail(res, 'description is required');
554  if (!project_type)      return fail(res, 'project_type is required');
555  if (!proposal_deadline) return fail(res, 'proposal_deadline is required');
556  try {
557    const rfp = await RFP.create({
558      client_id : userId, title, description, project_type,
559      proposal_deadline: new Date(proposal_deadline),
560      budget_min: budget_min ? parseFloat(budget_min) : null,
561      budget_max: budget_max ? parseFloat(budget_max) : null,
562      currency, privacy_level, status,
563      location: location || null,
564      view_count: 0,
565    });
566    ok(res, { rfp: rfp.toJSON() }, 'RFP created');
567  } catch(e) { fail(res, e.message); }
568}));
569
570// ── PUBLISH RFP (draft → open) ────────────────────────────────────
571router.post('/rfps/:id/publish', protect, wrap(async (req, res) => {
572  const userId = uid(req);
573  const rfp = await RFP.findByPk(req.params.id);
574  if (!rfp) return fail(res, 'RFP not found', 404);
575  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
576    return fail(res, 'Not authorised', 403);
577  await rfp.update({ status: 'open' });
578  ok(res, {}, 'RFP published');
579}));
580
581// ── CLOSE RFP ─────────────────────────────────────────────────────
582router.post('/rfps/:id/close', protect, wrap(async (req, res) => {
583  const userId = uid(req);
584  const rfp = await RFP.findByPk(req.params.id);
585  if (!rfp) return fail(res, 'RFP not found', 404);
586  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
587    return fail(res, 'Not authorised', 403);
588  await rfp.update({ status: 'completed' });
589  ok(res, {}, 'RFP closed');
590}));
591
592// ── SUBMIT proposal / BOQ ─────────────────────────────────────────
593router.post('/rfps/:id/proposals', protect, wrap(async (req, res) => {
594  const userId = uid(req);
595  const { cover_letter, proposed_budget, currency = 'USD',
596          estimated_duration, start_date, relevant_experience,
597          proposed_team, notes, boq_items, boq_total } = req.body;
598  if (!cover_letter)       return fail(res, 'cover_letter is required');
599  if (!proposed_budget)    return fail(res, 'proposed_budget is required');
600  if (!estimated_duration) return fail(res, 'estimated_duration is required');
601  const rfp = await RFP.findByPk(req.params.id);
602  if (!rfp) return fail(res, 'RFP not found', 404);
603  const data = {
604    rfp_id: req.params.id, professional_id: userId,
605    cover_letter, proposed_budget: parseFloat(proposed_budget), currency,
606    estimated_duration, start_date: start_date || null,
607    relevant_experience: relevant_experience || '',
608    proposed_team: proposed_team || '', notes: notes || '',
609    boq_items: boq_items || [], boq_total: boq_total || 0,
610    status: 'submitted', createdAt: new Date(),
611  };
612  let proposal = null;
613  if (Proposal) { try { proposal = (await Proposal.create(data)).toJSON(); } catch(e) {} }
614  if (!proposal) { proposal = { ...data, id: String(_boid++) }; mem.proposals.unshift(proposal); }
615  const prof = await getUser(userId);
616  await pushNotif(String(rfp.client_id), 'rfp',
617    `New proposal for: ${rfp.title}`,
618    `${prof?.name || 'A professional'} submitted a proposal — Budget: ${currency} ${parseFloat(proposed_budget).toLocaleString()}`
619  );
620  ok(res, { proposal }, 'Proposal submitted');
621}));
622
623// ── GET proposals for an RFP (client owner + admin) ───────────────
624router.get('/rfps/:id/proposals', protect, wrap(async (req, res) => {
625  const userId = uid(req);
626  const rfp    = await RFP.findByPk(req.params.id);
627  if (!rfp) return fail(res, 'RFP not found', 404);
628  if (String(rfp.client_id) !== String(userId) && req.user?.role !== 'admin')
629    return fail(res, 'Not authorised', 403);
630  let proposals = [];
631  if (Proposal) {
632    try {
633      proposals = (await Proposal.findAll({
634        where: { rfp_id: req.params.id }, order: [['createdAt', 'DESC']],
635        include: [{ model: User, as: 'professional', attributes: ['id','name','company','role'], required: false }],
636      })).map(p => p.toJSON());
637    } catch(e) { proposals = mem.proposals.filter(p => p.rfp_id === req.params.id); }
638  } else { proposals = mem.proposals.filter(p => p.rfp_id === req.params.id); }
639  ok(res, { proposals });
640}));
641
642// ═══════════════════════════════════════════════════════════════════
643//  MEMBERS DIRECTORY
644// ═══════════════════════════════════════════════════════════════════
645
646router.get('/members', protect, wrap(async (req, res) => {
647  const q     = (req.query.q || '').toLowerCase();
648  const limit = Math.min(100, parseInt(req.query.limit) || 50);
649  let users   = await getAllUsers();
650  if (q) users = users.filter(u =>
651    (u.name||'').toLowerCase().includes(q) ||
652    (u.company||'').toLowerCase().includes(q) ||
653    (u.role||'').toLowerCase().includes(q)
654  );
655  const members = users.slice(0, limit).map(u => ({
656    id: u.id, name: u.name, company: u.company || '',
657    role: u.role || '', location: u.location || '', bio: u.bio || '',
658    subscription_tier: u.subscription_tier || 'free',
659    is_verified: u.is_verified || false, createdAt: u.createdAt,
660  }));
661  ok(res, { members, total: members.length });
662}));
663
664// ═══════════════════════════════════════════════════════════════════
665//  ADMIN — SUBSCRIPTION, BAN, STATS
666// ═══════════════════════════════════════════════════════════════════
667
668// ── Admin: list all users ─────────────────────────────────────────
669router.get('/admin/users', protect, adminOnly, wrap(async (req, res) => {
670  try {
671    const users = (await User.findAll({ order: [['createdAt','DESC']] })).map(u => u.toPublicJSON());
672    ok(res, { users, total: users.length });
673  } catch(e) { fail(res, e.message); }
674}));
675
676// ── Admin: delete a user ──────────────────────────────────────────
677router.delete('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
678  try {
679    await User.destroy({ where: { id: req.params.id } });
680    ok(res, {}, 'User deleted');
681  } catch(e) { fail(res, e.message); }
682}));
683
684// ── Admin: update any user field (name, role, company, is_active, etc.) ──
685router.put('/admin/users/:id', protect, adminOnly, wrap(async (req, res) => {
686  const allowed = ['name','role','company','location','bio','is_active','is_verified'];
687  const updates = {};
688  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
689  if (!Object.keys(updates).length) return fail(res, 'No valid fields to update');
690  try {
691    await User.update(updates, { where: { id: req.params.id } });
692    const updated = await User.findByPk(req.params.id);
693    // Notify user if role changed
694    if (updates.role) {
695      await pushNotif(req.params.id, 'system',
696        `Your account role has been updated to: ${updates.role}`, '');
697    }
698    ok(res, { user: updated ? updated.toPublicJSON() : { id: req.params.id } }, 'User updated');
699  } catch(e) { fail(res, e.message); }
700}));
701
702router.put('/admin/users/:id/subscription', protect, adminOnly, wrap(async (req, res) => {
703  const { tier, status = 'active', end_date, note } = req.body;
704  const userId = req.params.id;
705  const subEnd = end_date ? new Date(end_date) : null;
706  await User.update({
707    subscription_tier: tier || 'free', subscription_status: status,
708    subscription_end: subEnd,
709  }, { where: { id: userId } });
710  const labels = { monthly: 'Monthly Pro', annual: 'Annual Pro', free: 'Free' };
711  let msg = `Your plan has been updated to ${labels[tier] || tier}`;
712  if (subEnd) msg += subEnd.getFullYear() >= 2099 ? ' — permanent access granted!'
713    : ` — valid until ${subEnd.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;
714  await pushNotif(userId, 'system', msg, note || '');
715  const updated = await User.findByPk(userId);
716  ok(res, { user: updated ? updated.toPublicJSON() : { id: userId } }, 'Subscription updated');
717}));
718
719router.put('/admin/users/:id/ban', protect, adminOnly, wrap(async (req, res) => {
720  const { banned } = req.body;
721  await User.update({ is_active: !banned }, { where: { id: req.params.id } });
722  await pushNotif(req.params.id, 'ban',
723    banned ? 'Your account has been suspended' : 'Your account has been reinstated');
724  ok(res, {}, banned ? 'User banned' : 'User unbanned');
725}));
726
727router.get('/admin/stats-extended', protect, adminOnly, wrap(async (req, res) => {
728  const users   = await getAllUsers();
729  const monthly = users.filter(u => u.subscription_tier === 'monthly' && u.subscription_status === 'active').length;
730  const annual  = users.filter(u => u.subscription_tier === 'annual'  && u.subscription_status === 'active').length;
731  let openRfps  = 0;
732  try { openRfps = await RFP.count({ where: { status: 'open' } }); } catch(e) {}
733  let totalPosts = 0;
734  if (Post) { try { totalPosts = await Post.count(); } catch(e) {} }
735  ok(res, {
736    users        : users.length,
737    monthly_subs : monthly,
738    annual_subs  : annual,
739    free_users   : users.filter(u => !u.subscription_tier || u.subscription_tier === 'free').length,
740    mrr          : monthly * 49 + annual * 39,
741    arr          : (monthly * 49 + annual * 39) * 12,
742    open_rfps    : openRfps,
743    posts        : totalPosts,
744    messages     : mem.messages.length,
745    broadcasts   : 0,
746  });
747}));
748
749// ═══════════════════════════════════════════════════════════════════
750//  LIBRARY
751// ═══════════════════════════════════════════════════════════════════
752
753// GET all active library files (members only)
754router.get('/library', protect, wrap(async (req, res) => {
755  const cat = req.query.category || null;
756  let files = [];
757  if (LibraryFile) {
758    try {
759      const where = { is_active: true };
760      if (cat) where.category = cat;
761      files = (await LibraryFile.findAll({
762        where,
763        order: [['createdAt', 'DESC']],
764      })).map(f => f.toJSON());
765    } catch(e) { files = mem.library.filter(f => f.is_active && (!cat || f.category === cat)); }
766  } else {
767    files = mem.library.filter(f => f.is_active && (!cat || f.category === cat));
768  }
769  ok(res, { files, total: files.length });
770}));
771
772// POST add a new library file (admin only)
773router.post('/library', protect, adminOnly, wrap(async (req, res) => {
774  const { title, description, category, url, filetype, size, access } = req.body;
775  if (!title) return fail(res, 'title is required');
776  if (!url)   return fail(res, 'url is required');
777  const data = {
778    title, description: description || '',
779    category: category || 'catalogue',
780    url, filetype: filetype || 'PDF',
781    size: size || '',
782    access: access || 'pro_only',
783    is_active: true,
784    download_count: 0,
785    uploaded_by: uid(req),
786    createdAt: new Date(),
787  };
788  let file = null;
789  if (LibraryFile) {
790    try { file = (await LibraryFile.create(data)).toJSON(); } catch(e) { console.error('[lib]', e.message); }
791  }
792  if (!file) { file = { ...data, id: String(_lid++) }; mem.library.unshift(file); }
793  ok(res, { file }, 'File added to library');
794}));
795
796// PUT update library file (admin only)
797router.put('/library/:id', protect, adminOnly, wrap(async (req, res) => {
798  const allowed = ['title','description','category','url','filetype','size','access','is_active'];
799  const updates = {};
800  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
801  if (LibraryFile) {
802    try { await LibraryFile.update(updates, { where: { id: req.params.id } }); } catch(e) {}
803  }
804  const ml = mem.library.find(f => f.id === req.params.id);
805  if (ml) Object.assign(ml, updates);
806  ok(res, {}, 'Updated');
807}));
808
809// DELETE library file (admin only)
810router.delete('/library/:id', protect, adminOnly, wrap(async (req, res) => {
811  if (LibraryFile) {
812    try { await LibraryFile.destroy({ where: { id: req.params.id } }); } catch(e) {}
813  }
814  mem.library = mem.library.filter(f => f.id !== req.params.id);
815  ok(res, {}, 'Deleted');
816}));
817
818// POST increment download count
819router.post('/library/:id/download', protect, wrap(async (req, res) => {
820  if (LibraryFile) {
821    try { await LibraryFile.increment('download_count', { where: { id: req.params.id } }); } catch(e) {}
822  }
823  ok(res, {}, 'Counted');
824}));
825
826// ═══════════════════════════════════════════════════════════════════
827//  AI PROJECT MATCHING
828// ═══════════════════════════════════════════════════════════════════
829
830// Helper: build professional profile summary for AI
831function buildProfSummary(user, portfolio = []) {
832  const parts = [];
833  parts.push(`Name: ${user.name}`);
834  parts.push(`Company: ${user.company || 'Independent'}`);
835  parts.push(`Location: ${user.location || 'Not specified'}`);
836  if (user.bio) parts.push(`Bio: ${user.bio}`);
837  if (portfolio.length) {
838    parts.push(`Portfolio projects (${portfolio.length}):`);
839    portfolio.slice(0, 5).forEach(p => {
840      parts.push(`  - ${p.title} | Type: ${p.project_type || 'N/A'} | Location: ${p.location || 'N/A'} | Value: ${p.project_value ? '$' + Number(p.project_value).toLocaleString() : 'N/A'}`);
841      if (p.description) parts.push(`    ${p.description.slice(0, 100)}`);
842    });
843  }
844  return parts.join('\n');
845}
846
847// GET /rfps/:id/matches — get AI top 5 matches for an RFP
848router.get('/rfps/:id/matches', protect, wrap(async (req, res) => {
849  const rfp = await RFP.findByPk(req.params.id);
850  if (!rfp) return fail(res, 'RFP not found', 404);
851
852  // Check cache first (safely — column may not exist yet)
853  try {
854    if (rfp.ai_matches && rfp.ai_matches_at) {
855      const age = Date.now() - new Date(rfp.ai_matches_at).getTime();
856      if (age < 24 * 60 * 60 * 1000) {
857        return ok(res, { matches: rfp.ai_matches, cached: true });
858      }
859    }
860  } catch(e) { /* column doesn't exist yet — skip cache */ }
861
862  // Get all active professionals
863  const professionals = await User.findAll({
864    where: { role: 'professional', is_active: true },
865    attributes: ['id', 'name', 'company', 'location', 'bio', 'subscription_tier'],
866  });
867
868  if (!professionals.length) return ok(res, { matches: [] });
869
870  // Load portfolios for all professionals
871  let portfolioMap = {};
872  if (Portfolio) {
873    const allPortfolios = await Portfolio.findAll({
874      where: { user_id: professionals.map(p => p.id) },
875    });
876    allPortfolios.forEach(p => {
877      if (!portfolioMap[p.user_id]) portfolioMap[p.user_id] = [];
878      portfolioMap[p.user_id].push(p.toJSON());
879    });
880  }
881
882  // Build RFP summary
883  const rfpData = rfp.toJSON ? rfp.toJSON() : rfp;
884  const rfpSummary = [
885    `Title: ${rfpData.title}`,
886    `Type: ${rfpData.project_type || rfpData.industry?.join(', ') || 'N/A'}`,
887    `Location: ${rfpData.location?.city || rfpData.location || 'N/A'}, ${rfpData.location?.country || ''}`,
888    `Budget: ${rfpData.budget_min ? '$' + rfpData.budget_min.toLocaleString() : 'N/A'} - ${rfpData.budget_max ? '$' + rfpData.budget_max.toLocaleString() : 'N/A'}`,
889    `Description: ${rfpData.description?.slice(0, 300) || 'N/A'}`,
890  ].join('\n');
891
892  // Build professionals list for AI
893  const profsList = professionals.map(p => ({
894    id: p.id,
895    summary: buildProfSummary(p.toJSON(), portfolioMap[p.id] || []),
896  }));
897
898  // Ask Claude to match
899  let matches = [];
900
901  if (Anthropic && process.env.ANTHROPIC_API_KEY) {
902    try {
903      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
904
905      const profsText = profsList.map((p, i) =>
906        `[PROFESSIONAL ${i+1}] ID: ${p.id}\n${p.summary}`
907      ).join('\n\n---\n\n');
908
909      const prompt = `You are a professional project matching AI for a construction and architecture marketplace.
910
911ANALYZE this RFP and find the TOP 5 best matching professionals.
912
913=== RFP ===
914${rfpSummary}
915
916=== PROFESSIONALS ===
917${profsText}
918
919MATCHING CRITERIA (in order of importance):
9201. Location match — same city/country/region scores highest
9212. Project type match — portfolio projects similar to RFP type
9223. Portfolio experience — relevant past projects
9234. Company/bio relevance
924
925Respond ONLY with valid JSON in this exact format, nothing else:
926{
927  "matches": [
928    {
929      "id": "professional-uuid-here",
930      "score": 95,
931      "reason": "One sentence explaining why they are a great match"
932    }
933  ]
934}
935
936Return exactly 5 matches (or fewer if less than 5 professionals exist). Order by score descending.`;
937
938      const response = await client.messages.create({
939        model: 'claude-opus-4-6',
940        max_tokens: 1024,
941        messages: [{ role: 'user', content: prompt }],
942      });
943
944      const text = response.content[0]?.text || '';
945      const clean = text.replace(/```json|```/g, '').trim();
946      const parsed = JSON.parse(clean);
947      matches = parsed.matches || [];
948
949    } catch (e) {
950      console.error('[AI Match] Error:', e.message);
951      // Fallback: simple scoring without AI
952      matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
953    }
954  } else {
955    // No AI key — use simple scoring
956    matches = simpleFallbackMatch(rfpData, professionals, portfolioMap);
957  }
958
959  // Enrich matches with user data
960  const enriched = await Promise.all(matches.slice(0, 5).map(async m => {
961    const user = professionals.find(p => String(p.id) === String(m.id));
962    if (!user) return null;
963    const portfolio = portfolioMap[m.id] || [];
964    return {
965      id: m.id,
966      name: user.name,
967      company: user.company || 'Independent',
968      location: user.location || '',
969      bio: user.bio || '',
970      subscription_tier: user.subscription_tier,
971      portfolio_count: portfolio.length,
972      portfolio_preview: portfolio.slice(0, 2).map(p => ({ title: p.title, type: p.project_type })),
973      score: m.score,
974      reason: m.reason,
975    };
976  }));
977
978  const finalMatches = enriched.filter(Boolean);
979
980  // Cache on RFP record if possible (silently skip if columns don't exist)
981  try {
982    await sequelize.query(
983      'UPDATE rfps SET ai_matches = :matches, ai_matches_at = :now WHERE id = :id',
984      { replacements: { matches: JSON.stringify(finalMatches), now: new Date(), id: req.params.id } }
985    );
986  } catch(e) { /* columns may not exist yet — that's ok */ }
987
988  ok(res, { matches: finalMatches });
989}));
990
991// POST /rfps/:id/matches/notify — notify matched professionals
992router.post('/rfps/:id/matches/notify', protect, wrap(async (req, res) => {
993  const rfp = await RFP.findByPk(req.params.id);
994  if (!rfp) return fail(res, 'RFP not found', 404);
995  // Only RFP owner or admin can notify
996  const rfpData = rfp.toJSON ? rfp.toJSON() : rfp;
997  if (String(rfpData.client_id) !== String(uid(req)) && req.user?.role !== 'admin')
998    return fail(res, 'Not authorised', 403);
999
1000  const { matches } = req.body;
1001  if (!matches?.length) return fail(res, 'No matches provided');
1002
1003  let notified = 0;
1004  for (const m of matches) {
1005    try {
1006      await pushNotif(
1007        m.id,
1008        'match',
1009        `🎯 New Project Match: ${rfpData.title}`,
1010        `You've been matched to a project that fits your profile! ${m.reason || ''} Click to view and submit a proposal.`
1011      );
1012      notified++;
1013    } catch(e) {}
1014  }
1015
1016  ok(res, { notified }, `Notified ${notified} professionals`);
1017}));
1018
1019// Simple fallback scoring without AI
1020function simpleFallbackMatch(rfp, professionals, portfolioMap) {
1021  const rfpLocation = (rfp.location?.country || rfp.location || '').toLowerCase();
1022  const rfpType = (rfp.project_type || rfp.industry?.[0] || '').toLowerCase();
1023
1024  return professionals.map(p => {
1025    let score = 50;
1026    const pData = p.toJSON ? p.toJSON() : p;
1027    const portfolio = portfolioMap[p.id] || [];
1028
1029    // Location match
1030    const pLoc = (pData.location || '').toLowerCase();
1031    if (rfpLocation && pLoc && pLoc.includes(rfpLocation.split(',')[0])) score += 25;
1032    else if (rfpLocation && pLoc && rfpLocation.includes(pLoc.split(',')[0])) score += 15;
1033
1034    // Project type match in portfolio
1035    if (rfpType) {
1036      const typeMatch = portfolio.filter(proj =>
1037        (proj.project_type || '').toLowerCase().includes(rfpType) ||
1038        rfpType.includes((proj.project_type || '').toLowerCase())
1039      );
1040      score += Math.min(typeMatch.length * 10, 20);
1041    }
1042
1043    // Portfolio size bonus
1044    score += Math.min(portfolio.length * 2, 10);
1045
1046    return {
1047      id: p.id,
1048      score: Math.min(score, 99),
1049      reason: `${pData.company || pData.name} has ${portfolio.length} portfolio projects and is based in ${pData.location || 'N/A'}.`
1050    };
1051  })
1052  .sort((a, b) => b.score - a.score)
1053  .slice(0, 5);
1054}
1055
1056// ═══════════════════════════════════════════════════════════════════
1057//  PORTFOLIO
1058// ═══════════════════════════════════════════════════════════════════
1059
1060// GET portfolio for a user
1061router.get('/portfolio/:userId', protect, wrap(async (req, res) => {
1062  if (!Portfolio) return ok(res, { portfolio: [] });
1063  try {
1064    const portfolio = (await Portfolio.findAll({
1065      where: { user_id: req.params.userId },
1066      order: [['createdAt', 'DESC']],
1067    })).map(p => p.toJSON());
1068    ok(res, { portfolio });
1069  } catch(e) { fail(res, e.message); }
1070}));
1071
1072// GET my portfolio
1073router.get('/portfolio', protect, wrap(async (req, res) => {
1074  if (!Portfolio) return ok(res, { portfolio: [] });
1075  try {
1076    const portfolio = (await Portfolio.findAll({
1077      where: { user_id: uid(req) },
1078      order: [['createdAt', 'DESC']],
1079    })).map(p => p.toJSON());
1080    ok(res, { portfolio });
1081  } catch(e) { fail(res, e.message); }
1082}));
1083
1084// POST create portfolio item
1085router.post('/portfolio', protect, wrap(async (req, res) => {
1086  const { title, description, project_type, location, completion_date,
1087          project_value, currency, images } = req.body;
1088  if (!title) return fail(res, 'title is required');
1089  if (!Portfolio) return fail(res, 'Portfolio model not available');
1090  try {
1091    const item = await Portfolio.create({
1092      user_id: uid(req), title, description, project_type,
1093      location, completion_date: completion_date ? new Date(completion_date) : null,
1094      project_value: project_value ? parseFloat(project_value) : null,
1095      currency: currency || 'USD',
1096      images: images || [],
1097    });
1098    ok(res, { item: item.toJSON() }, 'Portfolio item added');
1099  } catch(e) { fail(res, e.message); }
1100}));
1101
1102// PUT update portfolio item
1103router.put('/portfolio/:id', protect, wrap(async (req, res) => {
1104  if (!Portfolio) return fail(res, 'Portfolio model not available');
1105  const item = await Portfolio.findByPk(req.params.id);
1106  if (!item) return fail(res, 'Not found', 404);
1107  if (String(item.user_id) !== String(uid(req)) && req.user?.role !== 'admin')
1108    return fail(res, 'Not authorised', 403);
1109  const allowed = ['title','description','project_type','location','completion_date',
1110                   'project_value','currency','images','is_featured'];
1111  const updates = {};
1112  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
1113  await item.update(updates);
1114  ok(res, { item: item.toJSON() }, 'Updated');
1115}));
1116
1117// DELETE portfolio item
1118router.delete('/portfolio/:id', protect, wrap(async (req, res) => {
1119  if (!Portfolio) return fail(res, 'Portfolio model not available');
1120  const item = await Portfolio.findByPk(req.params.id);
1121  if (!item) return fail(res, 'Not found', 404);
1122  if (String(item.user_id) !== String(uid(req)) && req.user?.role !== 'admin')
1123    return fail(res, 'Not authorised', 403);
1124  await item.destroy();
1125  ok(res, {}, 'Deleted');
1126}));
1127
1128// ═══════════════════════════════════════════════════════════════════
1129//  REVIEWS
1130// ═══════════════════════════════════════════════════════════════════
1131
1132// Helper: calculate average ratings for a user
1133async function getAvgRatings(userId) {
1134  if (!Review) return null;
1135  try {
1136    const reviews = await Review.findAll({
1137      where: { reviewee_id: userId, is_approved: true },
1138    });
1139    if (!reviews.length) return null;
1140    const avg = (key) => {
1141      const vals = reviews.map(r => r[key]).filter(v => v > 0);
1142      return vals.length ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 10) / 10 : null;
1143    };
1144    return {
1145      overall      : avg('rating_overall'),
1146      quality      : avg('rating_quality'),
1147      communication: avg('rating_communication'),
1148      timeline     : avg('rating_timeline'),
1149      count        : reviews.length,
1150    };
1151  } catch(e) { return null; }
1152}
1153
1154// GET reviews for a user
1155router.get('/reviews/:userId', protect, wrap(async (req, res) => {
1156  if (!Review) return ok(res, { reviews: [], ratings: null });
1157  try {
1158    const reviews = (await Review.findAll({
1159      where: { reviewee_id: req.params.userId, is_approved: true },
1160      order: [['createdAt', 'DESC']],
1161      include: [
1162        { model: User, as: 'reviewer', attributes: ['id','name','company','role'], required: false },
1163      ],
1164    })).map(r => r.toJSON());
1165    const ratings = await getAvgRatings(req.params.userId);
1166    ok(res, { reviews, ratings });
1167  } catch(e) { fail(res, e.message); }
1168}));
1169
1170// POST write a review
1171router.post('/reviews', protect, wrap(async (req, res) => {
1172  const { reviewee_id, rfp_id, rating_overall, rating_quality,
1173          rating_communication, rating_timeline, body } = req.body;
1174  if (!reviewee_id)    return fail(res, 'reviewee_id is required');
1175  if (!rating_overall) return fail(res, 'rating_overall is required');
1176  if (!body)           return fail(res, 'Written review is required');
1177  if (String(reviewee_id) === String(uid(req)))
1178    return fail(res, 'You cannot review yourself');
1179  if (!Review) return fail(res, 'Review model not available');
1180  // Check: one review per reviewer per reviewee
1181  const existing = await Review.findOne({
1182    where: { reviewee_id, reviewer_id: uid(req) }
1183  });
1184  if (existing) return fail(res, 'You have already reviewed this member');
1185  try {
1186    const review = await Review.create({
1187      reviewee_id, reviewer_id: uid(req), rfp_id: rfp_id || null,
1188      rating_overall: parseInt(rating_overall),
1189      rating_quality: rating_quality ? parseInt(rating_quality) : null,
1190      rating_communication: rating_communication ? parseInt(rating_communication) : null,
1191      rating_timeline: rating_timeline ? parseInt(rating_timeline) : null,
1192      body, is_approved: true,
1193    });
1194    await pushNotif(reviewee_id, 'review',
1195      `New review from ${req.user?.name || 'a client'}`,
1196      `Rating: ${rating_overall}/5 — "${String(body).slice(0,80)}"`
1197    );
1198    ok(res, { review: review.toJSON() }, 'Review submitted');
1199  } catch(e) { fail(res, e.message); }
1200}));
1201
1202// DELETE review (own or admin)
1203router.delete('/reviews/:id', protect, wrap(async (req, res) => {
1204  if (!Review) return fail(res, 'Review model not available');
1205  const review = await Review.findByPk(req.params.id);
1206  if (!review) return fail(res, 'Not found', 404);
1207  if (String(review.reviewer_id) !== String(uid(req)) && req.user?.role !== 'admin')
1208    return fail(res, 'Not authorised', 403);
1209  await review.destroy();
1210  ok(res, {}, 'Deleted');
1211}));
1212
1213// Admin: approve/reject review
1214router.put('/admin/reviews/:id', protect, adminOnly, wrap(async (req, res) => {
1215  if (!Review) return fail(res, 'Review model not available');
1216  await Review.update({ is_approved: req.body.is_approved }, { where: { id: req.params.id } });
1217  ok(res, {}, 'Updated');
1218}));
1219
1220// ═══════════════════════════════════════════════════════════════════
1221//  ERROR HANDLER
1222// ═══════════════════════════════════════════════════════════════════
1223
1224router.use((err, req, res, next) => {
1225  console.error('[ext]', err.message);
1226  res.status(err.status || 500).json({
1227    status: 'error',
1228    error: { message: err.message || 'Internal server error' },
1229  });
1230});
1231
1232module.exports = router;
