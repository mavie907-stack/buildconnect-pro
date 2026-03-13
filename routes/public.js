/**
 * routes/public.js
 * Public-facing API — no auth required
 * Mounted at /api/v1/public
 */
const express = require('express');
const router  = express.Router();

// ── Helpers ───────────────────────────────────────────────────────
const ok   = (res, data, msg='ok') => res.json({ status:'success', message:msg, data });
const fail = (res, msg, code=400)  => res.status(code).json({ status:'error', error:{ message:msg } });
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// Optional model loader
function tryModel(path) { try { return require(path); } catch(e) { return null; } }

// ── GET /public/gallery ────────────────────────────────────────────
// Returns all public portfolio projects across all members
router.get('/gallery', wrap(async (req, res) => {
  const { type, search, sort='recent', limit=24, offset=0 } = req.query;

  let projects = [];

  const User = tryModel('../models/User');
  const Portfolio = tryModel('../models/Portfolio');

  if (Portfolio && User) {
    try {
      const { Op } = require('sequelize');
      const where = { is_public: true };
      if (type)   where.type = type;
      if (search) where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { location:    { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];

      const order = sort==='popular' ? [['view_count','DESC']]
                  : sort==='budget'  ? [['area','DESC']]
                  : [['createdAt','DESC']];

      const rows = await Portfolio.findAll({
        where,
        include: [{ model: User, as:'user', attributes:['id','name','company','role','avatar'] }],
        order,
        limit:  parseInt(limit),
        offset: parseInt(offset),
      });
      projects = rows.map(r => r.toJSON ? r.toJSON() : r);
    } catch(e) {
      console.error('[public/gallery] DB error:', e.message);
    }
  }

  // Fallback: build gallery from User portfolio JSON columns if Portfolio table doesn't exist
  if (!projects.length && User) {
    try {
      const { Op } = require('sequelize');
      const users = await User.findAll({
        where: { is_active: true },
        attributes: ['id','name','company','role','avatar','portfolio_projects'],
      });
      users.forEach(u => {
        const uData = u.toJSON ? u.toJSON() : u;
        let projs = [];
        try { projs = JSON.parse(uData.portfolio_projects || '[]'); } catch(e) {}
        projs.forEach(p => {
          if(!p.title) return;
          if(type && p.type !== type) return;
          if(search && !JSON.stringify(p).toLowerCase().includes(search.toLowerCase())) return;
          projects.push({
            ...p,
            user: { id:uData.id, name:uData.name, company:uData.company, role:uData.role, avatar:uData.avatar },
          });
        });
      });
      // Sort
      if(sort==='recent') projects.sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
      projects = projects.slice(parseInt(offset), parseInt(offset)+parseInt(limit));
    } catch(e) {
      console.error('[public/gallery] user fallback error:', e.message);
    }
  }

  ok(res, { projects, total: projects.length });
}));

// ── GET /public/gallery/featured ──────────────────────────────────
router.get('/gallery/featured', wrap(async (req, res) => {
  const User = tryModel('../models/User');
  let featured = [];

  if (User) {
    try {
      const users = await User.findAll({
        where: { is_active: true },
        attributes: ['id','name','company','role','avatar','portfolio_projects'],
        limit: 20,
      });
      users.forEach(u => {
        const uData = u.toJSON ? u.toJSON() : u;
        let projs = [];
        try { projs = JSON.parse(uData.portfolio_projects || '[]'); } catch(e) {}
        projs.filter(p=>p.featured&&p.title).forEach(p => {
          featured.push({
            ...p,
            user: { id:uData.id, name:uData.name, company:uData.company, role:uData.role, avatar:uData.avatar },
          });
        });
      });
      featured = featured.slice(0, 8);
    } catch(e) {}
  }

  ok(res, { projects: featured });
}));

// ── GET /public/gallery/types ─────────────────────────────────────
router.get('/gallery/types', wrap(async (req, res) => {
  const types = [
    'Residential','Commercial','Cultural','Educational',
    'Healthcare','Hospitality','Industrial','Mixed-Use',
    'Interior Design','Landscape','Urban Planning','Renovation','Other'
  ];
  ok(res, { types });
}));

// ── GET /public/gallery/stats ─────────────────────────────────────
router.get('/gallery/stats', wrap(async (req, res) => {
  const User = tryModel('../models/User');
  let stats = { projects: 0, professionals: 0, countries: 0, types: 0 };

  if (User) {
    try {
      const users = await User.findAll({
        where: { is_active: true },
        attributes: ['id','portfolio_projects','location'],
      });
      const countries = new Set();
      const types = new Set();
      let projCount = 0;
      let proCount = 0;
      users.forEach(u => {
        const uData = u.toJSON ? u.toJSON() : u;
        let projs = [];
        try { projs = JSON.parse(uData.portfolio_projects || '[]'); } catch(e) {}
        if(projs.length){ proCount++; projCount+=projs.length; }
        projs.forEach(p=>{ if(p.location) countries.add(p.location.split(',').pop().trim()); if(p.type) types.add(p.type); });
      });
      stats = { projects: projCount, professionals: proCount, countries: countries.size, types: types.size };
    } catch(e) {}
  }

  ok(res, { stats });
}));

// ── GET /public/members ───────────────────────────────────────────
router.get('/members', wrap(async (req, res) => {
  const User = tryModel('../models/User');
  if (!User) return ok(res, { members: [] });

  const { search, role, limit=20, offset=0 } = req.query;
  try {
    const { Op } = require('sequelize');
    const where = { is_active: true, role: { [Op.ne]: 'admin' } };
    if (role)   where.role = role;
    if (search) where[Op.or] = [
      { name:    { [Op.iLike]: `%${search}%` } },
      { company: { [Op.iLike]: `%${search}%` } },
    ];
    const rows = await User.findAll({
      where,
      attributes: ['id','name','company','role','avatar','location','bio','subscription_tier'],
      order: [['createdAt','DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    ok(res, { members: rows.map(r=>r.toJSON?r.toJSON():r) });
  } catch(e) {
    ok(res, { members: [] });
  }
}));

// ── GET /public/rfps ──────────────────────────────────────────────
router.get('/rfps', wrap(async (req, res) => {
  const RFP  = tryModel('../models/RFP');
  const User = tryModel('../models/User');
  if (!RFP) return ok(res, { rfps: [] });

  try {
    const { Op } = require('sequelize');
    const rows = await RFP.findAll({
      where: { status:'open', privacy_level:'public' },
      include: User ? [{ model:User, as:'client', attributes:['id','name','company','avatar'] }] : [],
      order: [['createdAt','DESC']],
      limit: 12,
    });
    ok(res, { rfps: rows.map(r=>r.toJSON?r.toJSON():r) });
  } catch(e) {
    ok(res, { rfps: [] });
  }
}));

module.exports = router;
