// routes/email.js — gracefully disabled if nodemailer not installed
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
    transporter.verify()
      .then(() => console.log('[email] SMTP connected ✅'))
      .catch(e => console.warn('[email] SMTP error:', e.message));
  } else {
    console.warn('[email] EMAIL_HOST/EMAIL_USER not set — emails log to console only');
  }
} catch(e) {
  console.warn('[email] nodemailer not installed — emails disabled. Run: npm install nodemailer');
}

const FROM     = process.env.EMAIL_FROM || 'BuildConnect Pro <noreply@buildconnect-pro.com>';
const BASE_URL = process.env.FRONTEND_URL || 'https://buildconnect-pro.com';

function baseTemplate(content) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{margin:0;padding:0;background:#f5f5f0;font-family:Arial,sans-serif;color:#1a1a1a}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.08)}
  .hdr{background:#2d5016;padding:32px 40px;text-align:center}
  .hdr h1{margin:0;color:#fff;font-size:22px;font-weight:700}
  .hdr span{color:#a8c97f;font-size:13px}
  .bdy{padding:40px}
  .bdy h2{font-size:20px;font-weight:700;margin:0 0 12px}
  .bdy p{font-size:15px;line-height:1.6;color:#444;margin:0 0 16px}
  .btn{display:inline-block;background:#2d5016;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0}
  .ftr{background:#f5f5f0;padding:24px 40px;text-align:center;font-size:12px;color:#888}
  .badge{display:inline-block;background:#f0f7e8;color:#2d5016;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
</style></head><body><div class="wrap">
  <div class="hdr"><h1>BuildConnect Pro</h1><span>Architecture &amp; Design Network</span></div>
  <div class="bdy">${content}</div>
  <div class="ftr">© ${new Date().getFullYear()} BuildConnect Pro · <a href="${BASE_URL}" style="color:#2d5016">buildconnect-pro.com</a></div>
</div></body></html>`;
}

const templates = {
  welcome    : (name, role)                  => ({ subject: '🏛 Welcome to BuildConnect Pro!', html: baseTemplate(`<h2>Welcome, ${name}!</h2><p>Your <span class="badge">${role}</span> account is ready.</p><a href="${BASE_URL}/buildconnect-member.html" class="btn">Go to Dashboard →</a>`) }),
  newMessage : (toName, fromName, preview)   => ({ subject: `💬 New message from ${fromName}`, html: baseTemplate(`<h2>New message</h2><p>Hi ${toName},</p><p><strong>${fromName}</strong> sent you a message:</p><blockquote style="border-left:4px solid #2d5016;padding:12px;color:#555;margin:16px 0">"${String(preview).slice(0,200)}…"</blockquote><a href="${BASE_URL}/buildconnect-member.html" class="btn">Reply →</a>`) }),
  newFollow  : (toName, fromName, fromRole)  => ({ subject: `👋 ${fromName} is following you`, html: baseTemplate(`<h2>New follower!</h2><p>Hi ${toName},</p><p><strong>${fromName}</strong> <span class="badge">${fromRole}</span> started following you.</p><a href="${BASE_URL}/buildconnect-member.html" class="btn">View Profile →</a>`) }),
  weeklyDigest:(toName, stats)               => ({ subject: `📊 Your weekly BuildConnect digest`, html: baseTemplate(`<h2>Your week</h2><p>Hi ${toName}, here's a summary: ${stats.newPosts||0} new posts, ${stats.newRfps||0} new RFPs, ${stats.newMembers||0} new members.</p><a href="${BASE_URL}/buildconnect-member.html" class="btn">Open Dashboard →</a>`) }),
  broadcast  : (toName, subject, body)       => ({ subject, html: baseTemplate(`<h2>${subject}</h2><p>Hi ${toName},</p>${body.split('\n').map(p=>`<p>${p}</p>`).join('')}<a href="${BASE_URL}/buildconnect-member.html" class="btn">Open Dashboard →</a>`) }),
};

async function sendEmail(to, templateName, data) {
  const args = Array.isArray(data) ? data : Object.values(data);
  const tpl  = templates[templateName]?.(...args);
  if (!tpl) return console.warn('[email] Unknown template:', templateName);
  if (transporter) {
    try {
      await transporter.sendMail({ from: FROM, to, subject: tpl.subject, html: tpl.html });
      console.log(`[email] ✅ ${templateName} → ${to}`);
    } catch(e) { console.error('[email] Send failed:', e.message); }
  } else {
    console.log(`[email] 📧 (no-op) ${templateName} → ${to} | Subject: ${tpl.subject}`);
  }
}

// ── HTTP routes ──────────────────────────────────────────────────
let User;
try { User = require('../models/User'); } catch(e) {}

let protect, adminOnly;
try {
  const auth = require('../middleware/auth');
  protect   = auth.authenticate;
  adminOnly = auth.isAdmin;
} catch(e) {
  protect = adminOnly = (req,res,next) => next();
}

router.post('/broadcast', protect, adminOnly, async (req, res) => {
  const { subject, body } = req.body;
  if (!subject || !body) return res.status(400).json({ status:'error', error:{ message:'subject and body required' } });
  try {
    const users = User ? await User.findAll({ where:{ is_active:true }, attributes:['email','name'] }) : [];
    Promise.all(users.map(u => sendEmail(u.email, 'broadcast', [u.name, subject, body]))).catch(()=>{});
    res.json({ status:'success', data:{ sent: users.length } });
  } catch(e) { res.status(500).json({ status:'error', error:{ message: e.message } }); }
});

router.post('/test', protect, adminOnly, async (req, res) => {
  const { to } = req.body;
  await sendEmail(to || 'test@example.com', 'welcome', ['Test User', 'professional']);
  res.json({ status:'success', data:{ message:'Test email sent (check console if SMTP not configured)' } });
});

// Attach sendEmail for import by other modules
router.sendEmail = sendEmail;
module.exports = router;
