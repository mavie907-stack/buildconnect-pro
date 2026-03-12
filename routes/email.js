// ═══════════════════════════════════════════════════════════════════
//  routes/email.js — BuildConnect Pro email system
//  Uses nodemailer with SMTP (env vars: EMAIL_HOST, EMAIL_PORT,
//  EMAIL_USER, EMAIL_PASS, EMAIL_FROM)
//  Falls back to console.log if not configured.
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();

let transporter;
try {
  const nodemailer = require('nodemailer');
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER) {
    transporter = nodemailer.createTransport({
      host  : process.env.EMAIL_HOST,
      port  : parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth  : { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    transporter.verify().then(() => console.log('[email] SMTP connected ✅')).catch(e => console.warn('[email] SMTP error:', e.message));
  } else {
    console.warn('[email] EMAIL_HOST/EMAIL_USER not set — emails will log to console only');
  }
} catch(e) { console.warn('[email] nodemailer not available:', e.message); }

const FROM = process.env.EMAIL_FROM || 'BuildConnect Pro <noreply@buildconnect-pro.com>';
const BASE_URL = process.env.FRONTEND_URL || 'https://buildconnect-pro.com';

// ── Email templates ──────────────────────────────────────────────
function baseTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f5f5f0;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.08);}
  .header{background:#2d5016;padding:32px 40px;text-align:center;}
  .header h1{margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-.5px;}
  .header span{color:#a8c97f;font-size:13px;}
  .body{padding:40px;}
  .body h2{font-size:20px;font-weight:700;margin:0 0 12px;}
  .body p{font-size:15px;line-height:1.6;color:#444;margin:0 0 16px;}
  .btn{display:inline-block;background:#2d5016;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0;}
  .footer{background:#f5f5f0;padding:24px 40px;text-align:center;font-size:12px;color:#888;}
  .divider{border:none;border-top:1px solid #eee;margin:24px 0;}
  .badge{display:inline-block;background:#f0f7e8;color:#2d5016;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;}
</style></head>
<body><div class="wrap">
  <div class="header"><h1>BuildConnect Pro</h1><span>Architecture & Design Network</span></div>
  <div class="body">${content}</div>
  <div class="footer">© ${new Date().getFullYear()} BuildConnect Pro · <a href="${BASE_URL}" style="color:#2d5016">buildconnect-pro.com</a><br>You're receiving this because you're a BuildConnect Pro member.</div>
</div></body></html>`;
}

const templates = {
  welcome: (name, role) => ({
    subject: '🏛 Welcome to BuildConnect Pro!',
    html: baseTemplate(`
      <h2>Welcome, ${name}! 👋</h2>
      <p>You've joined the premier network for architecture and design professionals. Your <span class="badge">${role}</span> account is ready.</p>
      <p>Here's what you can do right now:</p>
      <ul style="color:#444;line-height:2">
        <li>📝 Share your first post in the community feed</li>
        <li>🔍 Browse open RFPs and submit proposals</li>
        <li>👥 Connect with architects and designers</li>
        <li>📚 Access the professional library</li>
      </ul>
      <a href="${BASE_URL}/buildconnect-member.html" class="btn">Go to Dashboard →</a>
    `),
  }),

  newMessage: (toName, fromName, preview) => ({
    subject: `💬 New message from ${fromName}`,
    html: baseTemplate(`
      <h2>You have a new message</h2>
      <p>Hi ${toName},</p>
      <p><strong>${fromName}</strong> sent you a message on BuildConnect Pro:</p>
      <div style="background:#f5f5f0;border-left:4px solid #2d5016;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;font-style:italic;color:#555">"${preview.slice(0,200)}${preview.length>200?'…':''}"</div>
      <a href="${BASE_URL}/buildconnect-member.html#messages" class="btn">Reply Now →</a>
    `),
  }),

  newFollow: (toName, fromName, fromRole) => ({
    subject: `👋 ${fromName} is now following you`,
    html: baseTemplate(`
      <h2>You have a new follower!</h2>
      <p>Hi ${toName},</p>
      <p><strong>${fromName}</strong> <span class="badge">${fromRole}</span> started following you on BuildConnect Pro.</p>
      <p>Check out their profile and follow back to grow your professional network.</p>
      <a href="${BASE_URL}/buildconnect-member.html#members" class="btn">View Profile →</a>
    `),
  }),

  rfpMatch: (toName, rfpTitle, budget, deadline) => ({
    subject: `🏗 New RFP matches your profile: ${rfpTitle}`,
    html: baseTemplate(`
      <h2>A new project opportunity!</h2>
      <p>Hi ${toName},</p>
      <p>A new RFP was posted that matches your profile:</p>
      <div style="background:#f0f7e8;border-radius:8px;padding:20px;margin:16px 0">
        <div style="font-size:18px;font-weight:700;color:#2d5016;margin-bottom:8px">${rfpTitle}</div>
        <div style="color:#555;font-size:13px">💰 Budget: ${budget || 'Negotiable'} &nbsp;·&nbsp; 📅 Deadline: ${deadline || 'Open'}</div>
      </div>
      <a href="${BASE_URL}/buildconnect-member.html#rfps" class="btn">View & Apply →</a>
    `),
  }),

  weeklyDigest: (toName, stats) => ({
    subject: `📊 Your weekly BuildConnect Pro digest`,
    html: baseTemplate(`
      <h2>Your week on BuildConnect Pro</h2>
      <p>Hi ${toName}, here's what happened this week:</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0">
        <div style="background:#f0f7e8;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2d5016">${stats.newPosts||0}</div>
          <div style="font-size:12px;color:#666">New Posts</div>
        </div>
        <div style="background:#f0f7e8;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2d5016">${stats.newRfps||0}</div>
          <div style="font-size:12px;color:#666">New RFPs</div>
        </div>
        <div style="background:#f0f7e8;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2d5016">${stats.newMembers||0}</div>
          <div style="font-size:12px;color:#666">New Members</div>
        </div>
        <div style="background:#f0f7e8;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2d5016">${stats.onlineNow||0}</div>
          <div style="font-size:12px;color:#666">Online Now</div>
        </div>
      </div>
      <a href="${BASE_URL}/buildconnect-member.html" class="btn">Open Dashboard →</a>
    `),
  }),

  broadcast: (toName, subject, body) => ({
    subject,
    html: baseTemplate(`
      <h2>${subject}</h2>
      <p>Hi ${toName},</p>
      ${body.split('\n').map(p => `<p>${p}</p>`).join('')}
      <hr class="divider">
      <a href="${BASE_URL}/buildconnect-member.html" class="btn">Open Dashboard →</a>
    `),
  }),
};

// ── Core send function ───────────────────────────────────────────
async function sendEmail(to, templateName, data) {
  const tpl = templates[templateName]?.(...Object.values(data));
  if (!tpl) { console.warn('[email] Unknown template:', templateName); return; }

  if (transporter) {
    try {
      await transporter.sendMail({ from: FROM, to, subject: tpl.subject, html: tpl.html });
      console.log(`[email] ✅ ${templateName} → ${to}`);
    } catch(e) { console.error('[email] Send failed:', e.message); }
  } else {
    console.log(`[email] 📧 (console) ${templateName} → ${to}\nSubject: ${tpl.subject}`);
  }
}

// Export router as default (for app.use) with sendEmail attached
router.sendEmail = sendEmail;
module.exports = router;

// ── HTTP routes (admin-triggered) ───────────────────────────────
let User;
try { User = require('../models/User'); } catch(e) {}

const auth   = require('../middleware/auth');
const protect = auth.authenticate;
const adminOnly = auth.isAdmin;

// Send broadcast email to all or filtered members
router.post('/broadcast', protect, adminOnly, async (req, res) => {
  const { subject, body, filter } = req.body;
  if (!subject || !body) return res.status(400).json({ status:'error', error:{ message:'subject and body required' } });
  try {
    let users = [];
    if (User) users = await User.findAll({ where:{ is_active:true }, attributes:['email','name'] });
    const filtered = filter === 'pro' ? users.filter(u => u.subscription_tier !== 'free') : users;
    // Send in background
    Promise.all(filtered.map(u => sendEmail(u.email, 'broadcast', { toName:u.name, subject, body }))).catch(()=>{});
    res.json({ status:'success', data:{ sent: filtered.length } });
  } catch(e) { res.status(500).json({ status:'error', error:{ message:e.message } }); }
});

// Test email
router.post('/test', protect, adminOnly, async (req, res) => {
  const { to } = req.body;
  await sendEmail(to||'test@example.com', 'welcome', { name:'Test User', role:'professional' });
  res.json({ status:'success', data:{ message:'Test email sent' } });
});

// Weekly digest trigger (call via cron or manually)
router.post('/weekly-digest', protect, adminOnly, async (req, res) => {
  try {
    let users = [];
    if (User) users = await User.findAll({ where:{ is_active:true }, attributes:['email','name'] });
    const stats = req.body.stats || { newPosts:0, newRfps:0, newMembers:0, onlineNow:0 };
    Promise.all(users.map(u => sendEmail(u.email, 'weeklyDigest', { toName:u.name, stats }))).catch(()=>{});
    res.json({ status:'success', data:{ sent: users.length } });
  } catch(e) { res.status(500).json({ status:'error', error:{ message:e.message } }); }
});
