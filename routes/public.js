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

function tryModel(p) { try { return require(p); } catch(e) { return null; } }

// Safe JSON parse of portfolio_projects field (string or array)
function parsePortfolio(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch(e) { return []; }
}

// Fetch all active users with their portfolio data via raw SQL
// so it works even when portfolio_projects isn't in the Sequelize model definition
async function fetchUsersWithPortfolios() {
  const User = tryModel('../models/User');
  if (!User) return [];
  try {
    const sequelize = User.sequelize;
    if (!sequelize) throw new Error('no sequelize');

    // Raw SQL — returns portfolio_projects regardless of model definition
    const [rows] = await sequelize.query(
      `SELECT id, name, company, role, avatar, location, portfolio_projects
       FROM "Users" WHERE is_active = true`,
      { type: sequelize.QueryTypes ? sequelize.QueryTypes.SELECT : 'SELECT' }
    ).catch(() =>
      // MySQL (no double-quotes)
      sequelize.query(
        `SELECT id, name, company, role, avatar, location, portfolio_projects
         FROM Users WHERE is_active = 1`,
        { type: 'SELECT' }
      )
    );
    return Array.isArray(rows) ? rows : (rows ? [rows] : []);
  } catch(e) {
    console.error('[public] fetchUsersWithPortfolios error:', e.message);
    // ORM fallback — won't have portfolio_projects but at least returns users
    try {
      const rows = await User.findAll({
        where: { is_active: true },
        attributes: { exclude: ['password', 'reset_token', 'verification_token'] },
      });
      return rows.map(r => r.toJSON ? r.toJSON() : r);
    } catch(e2) { return []; }
  }
}

// ── GET /public/gallery ────────────────────────────────────────────
router.get('/gallery', wrap(async (req, res) => {
  const { type, search, sort='recent', limit=24, offset=0 } = req.query;

  const users = await fetchUsersWithPortfolios();
  let projects = [];

  users.forEach(u => {
    const projs = parsePortfolio(u.portfolio_projects);
    projs.forEach(p => {
      if (!p || !p.title) return;
      if (p.is_public === false) return;
      if (type   && p.type !== type) return;
      if (search && !JSON.stringify(p).toLowerCase().includes(search.toLowerCase())) return;
      projects.push({
        ...p,
        user: { id:u.id, name:u.name, company:u.company, role:u.role, avatar:u.avatar },
      });
    });
  });

  // Sort
  if (sort === 'popular') projects.sort((a,b) => (b.view_count||0)-(a.view_count||0));
  else if (sort === 'budget') projects.sort((a,b) => (parseFloat(b.area)||0)-(parseFloat(a.area)||0));
  else projects.sort((a,b) => new Date(b.updated_at||b.created_at||0) - new Date(a.updated_at||a.created_at||0));

  const total = projects.length;
  projects = projects.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

  ok(res, { projects, total });
}));

// ── GET /public/gallery/featured ──────────────────────────────────
router.get('/gallery/featured', wrap(async (req, res) => {
  const users = await fetchUsersWithPortfolios();
  let featured = [];

  users.forEach(u => {
    const projs = parsePortfolio(u.portfolio_projects);
    projs.filter(p => p && p.featured && p.title && p.is_public !== false).forEach(p => {
      featured.push({
        ...p,
        user: { id:u.id, name:u.name, company:u.company, role:u.role, avatar:u.avatar },
      });
    });
  });

  featured = featured.slice(0, 8);
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
  const users = await fetchUsersWithPortfolios();
  const countries = new Set();
  const types = new Set();
  let projCount = 0;
  let proCount  = 0;

  users.forEach(u => {
    const projs = parsePortfolio(u.portfolio_projects).filter(p => p && p.title && p.is_public !== false);
    if (projs.length) { proCount++; projCount += projs.length; }
    projs.forEach(p => {
      if (p.location) countries.add(p.location.split(',').pop().trim());
      if (p.type)     types.add(p.type);
    });
  });

  ok(res, { stats: { projects: projCount, professionals: proCount, countries: countries.size, types: types.size } });
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
      attributes: { exclude: ['password', 'reset_token', 'verification_token'] },
      order: [['createdAt','DESC']],
      limit:  parseInt(limit),
      offset: parseInt(offset),
    });
    ok(res, { members: rows.map(r => r.toJSON ? r.toJSON() : r) });
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
    ok(res, { rfps: rows.map(r => r.toJSON ? r.toJSON() : r) });
  } catch(e) {
    ok(res, { rfps: [] });
  }
}));

module.exports = router;
