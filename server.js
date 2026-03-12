require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const fs         = require('fs');

// Socket.io real-time
let socketModule;
try { socketModule = require('./socket'); console.log('[server] socket.js loaded'); } catch(e) { console.warn('[server] socket.js missing:', e.message); }

const sequelize = require('./config/database');
const User = require('./models/User');
const RFP  = require('./models/RFP');

// Safe optional models
let Post, Message, Notification, Proposal, Comment, Follow, Event, Library, Badge;
try { Post         = require('./models/Post');         } catch(e) { console.warn('⚠️  models/Post missing');         }
try { Message      = require('./models/Message');      } catch(e) { console.warn('⚠️  models/Message missing');      }
try { Notification = require('./models/Notification'); } catch(e) { console.warn('⚠️  models/Notification missing'); }
try { Proposal     = require('./models/Proposal');     } catch(e) { console.warn('⚠️  models/Proposal missing');     }
try { Comment      = require('./models/Comment');      } catch(e) { console.warn('⚠️  models/Comment missing');      }
try { Follow       = require('./models/Follow');       } catch(e) { console.warn('⚠️  models/Follow missing');       }
try { Event        = require('./models/Event');        } catch(e) { console.warn('⚠️  models/Event missing');        }
try { Library      = require('./models/Library');      } catch(e) { console.warn('⚠️  models/Library missing');      }
try { Badge        = require('./models/Badge');        } catch(e) { console.warn('⚠️  models/Badge missing');        }

// ── Associations (MUST be before routes) ──────────────────────────
User.hasMany(RFP, { foreignKey: 'client_id', as: 'rfps'   });
RFP.belongsTo(User, { foreignKey: 'client_id', as: 'client' });
if (Post) {
  User.hasMany(Post, { foreignKey: 'author_id', as: 'posts'  });
  Post.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
}
if (Message) {
  User.hasMany(Message, { foreignKey: 'sender_id',   as: 'sentMessages' });
  User.hasMany(Message, { foreignKey: 'receiver_id', as: 'recvMessages' });
  Message.belongsTo(User, { foreignKey: 'sender_id',   as: 'sender'   });
  Message.belongsTo(User, { foreignKey: 'receiver_id', as: 'receiver' });
}
if (Notification) {
  User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
}
if (Proposal) {
  RFP.hasMany(Proposal,    { foreignKey: 'rfp_id',          as: 'proposals'    });
  Proposal.belongsTo(RFP,  { foreignKey: 'rfp_id',          as: 'rfp'          });
  User.hasMany(Proposal,   { foreignKey: 'professional_id', as: 'proposals'    });
  Proposal.belongsTo(User, { foreignKey: 'professional_id', as: 'professional' });
}
if (Comment) {
  Post && Post.hasMany(Comment, { foreignKey: 'post_id',   as: 'comments' });
  Comment.belongsTo(Post && Post, { foreignKey: 'post_id', as: 'post'     });
  User.hasMany(Comment,   { foreignKey: 'author_id', as: 'comments' });
  Comment.belongsTo(User, { foreignKey: 'author_id', as: 'author'   });
}
if (Follow) {
  User.hasMany(Follow,  { foreignKey: 'follower_id',  as: 'following' });
  User.hasMany(Follow,  { foreignKey: 'following_id', as: 'followers' });
  Follow.belongsTo(User, { foreignKey: 'follower_id',  as: 'follower'  });
  Follow.belongsTo(User, { foreignKey: 'following_id', as: 'followedUser' });
}

// ── Safe optional routes ───────────────────────────────────────────
let ext, subscriptionRoutes, emailRoutes, publicRoutes;
try { ext                = require('./routes/extension');    } catch(e) { console.warn('⚠️  routes/extension missing');    }
try { subscriptionRoutes = require('./routes/subscription'); } catch(e) { console.warn('⚠️  routes/subscription missing'); }
try { emailRoutes        = require('./routes/email');        } catch(e) { console.warn('⚠️  routes/email missing');        }
try { publicRoutes       = require('./routes/public');       } catch(e) { console.warn('⚠️  routes/public missing');       }

// ── Required routes ────────────────────────────────────────────────
const authRoutes  = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const rfpRoutes   = require('./routes/rfp');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy:   false,
}));
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static uploads ─────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(uploadsDir));

// ── Health / root ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});
app.get('/', (req, res) => {
  res.json({ message: 'BuildConnect Pro API 🚀', version: '1.0.0', status: 'running' });
});

// ── Routes ─────────────────────────────────────────────────────────
if (ext)               app.use('/api/v1',               ext);
app.use('/api/v1/auth',  authRoutes);
app.use('/api/v1/rfps',  rfpRoutes);
app.use('/api/v1/admin', adminRoutes);
if (subscriptionRoutes) app.use('/api/v1/subscription', subscriptionRoutes);
if (emailRoutes)        app.use('/api/v1/email',        emailRoutes);
if (publicRoutes)       app.use('/api/v1/public',       publicRoutes);

// ── 404 ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found', statusCode: 404 } });
});

// ── Error handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: { message: err.message || 'Internal server error', statusCode: err.statusCode || 500 },
  });
});

// ── Start ──────────────────────────────────────────────────────────
async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected!');
    await sequelize.sync({ alter: { drop: false } }); // creates missing tables/cols, never alters existing column types
    console.log('✅ Database synchronized!');

    const adminEmail    = 'ibrtoros@unoliva.com';
    const adminPassword = 'BuildConnect2025!';
    const adminUser     = await User.findOne({ where: { email: adminEmail } });
    if (adminUser) {
      if (adminUser.role !== 'admin') await adminUser.update({ role: 'admin' });
      await adminUser.update({ password: adminPassword });
      console.log(`🔑 Admin password reset: ${adminEmail} / ${adminPassword}`);
    } else {
      await User.create({
        email: adminEmail,
        password: adminPassword,
        name: 'Admin', role: 'admin',
        is_verified: true, is_active: true,
      });
      console.log(`👑 Admin created: ${adminEmail} / ${adminPassword}`);
    }

    const httpServer = http.createServer(app);
    if (socketModule) {
      socketModule.initSocket(httpServer);
    }
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`👑 Admin: ${adminEmail}`);
      if (socketModule) console.log(`⚡ WebSockets: enabled`);
    });
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

startServer();
module.exports = app;
