// ═══════════════════════════════════════════════════════════════════
//  Badge definitions & award logic
// ═══════════════════════════════════════════════════════════════════
const BADGE_DEFS = {
  first_post      : { name:'First Post',        icon:'✍️',  desc:'Shared your first post with the community' },
  ten_posts       : { name:'Active Contributor', icon:'🔥',  desc:'Published 10 posts' },
  fifty_posts     : { name:'Thought Leader',     icon:'💡',  desc:'Published 50 posts' },
  first_follow    : { name:'Networker',          icon:'🤝',  desc:'Connected with your first member' },
  fifty_followers : { name:'Rising Star',        icon:'⭐',  desc:'Gained 50 followers' },
  hun_followers   : { name:'Influencer',         icon:'🌟',  desc:'Gained 100 followers' },
  first_rfp       : { name:'Deal Maker',         icon:'📋',  desc:'Posted your first RFP' },
  library_upload  : { name:'Knowledge Sharer',   icon:'📚',  desc:'Uploaded a resource to the library' },
  profile_complete: { name:'All Star',           icon:'💎',  desc:'Completed your full profile' },
  early_adopter   : { name:'Early Adopter',      icon:'🚀',  desc:'One of the first 100 members' },
  verified        : { name:'Verified Pro',       icon:'✅',  desc:'Verified professional member' },
};

let Badge, User;
try { Badge = require('../models/Badge'); } catch(e) {}
try { User  = require('../models/User');  } catch(e) {}

async function awardBadge(userId, badgeKey) {
  if (!Badge) return null;
  const def = BADGE_DEFS[badgeKey];
  if (!def) return null;
  try {
    const [badge, created] = await Badge.findOrCreate({
      where: { user_id: userId, badge_key: badgeKey },
      defaults: { user_id: userId, badge_key: badgeKey, badge_name: def.name, badge_icon: def.icon, badge_desc: def.desc },
    });
    if (created) {
      console.log(`[badges] 🏅 Awarded ${badgeKey} to ${userId}`);
      // Emit socket notification if available
      try {
        const { emitToUser } = require('./socket');
        emitToUser(userId, 'badge:earned', { badge: badge.toJSON() });
      } catch(e) {}
      // Also create a notification
      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          user_id: userId,
          type   : 'badge',
          title  : `Badge earned: ${def.icon} ${def.name}`,
          body   : def.desc,
        });
      } catch(e) {}
    }
    return created ? badge : null;
  } catch(e) {
    if (!e.message.includes('unique')) console.error('[badges] awardBadge error:', e.message);
    return null;
  }
}

async function checkAndAwardBadges(userId, trigger, counts = {}) {
  const awards = [];
  if (trigger === 'post') {
    if (counts.posts >= 1)  awards.push(awardBadge(userId, 'first_post'));
    if (counts.posts >= 10) awards.push(awardBadge(userId, 'ten_posts'));
    if (counts.posts >= 50) awards.push(awardBadge(userId, 'fifty_posts'));
  }
  if (trigger === 'follow') {
    if (counts.following >= 1)   awards.push(awardBadge(userId, 'first_follow'));
  }
  if (trigger === 'followers') {
    if (counts.followers >= 50)  awards.push(awardBadge(userId, 'fifty_followers'));
    if (counts.followers >= 100) awards.push(awardBadge(userId, 'hun_followers'));
  }
  if (trigger === 'rfp')     awards.push(awardBadge(userId, 'first_rfp'));
  if (trigger === 'library') awards.push(awardBadge(userId, 'library_upload'));
  await Promise.allSettled(awards);
}

async function getUserBadges(userId) {
  if (!Badge) return [];
  try {
    const rows = await Badge.findAll({ where:{ user_id: userId }, order:[['awarded_at','ASC']] });
    return rows.map(r => r.toJSON());
  } catch(e) { return []; }
}

module.exports = { awardBadge, checkAndAwardBadges, getUserBadges, BADGE_DEFS };
