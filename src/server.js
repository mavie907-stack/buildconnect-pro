require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const sequelize = require('./config/database');
const User = require('./models/User');
const RFP = require('./models/RFP');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const adminRoutes = require('./routes/admin');
const emailRoutes = require('./routes/email');
const rfpRoutes = require('./routes/rfp');
const publicRoutes = require('./routes/public');

User.hasMany(RFP, { foreignKey: 'client_id', as: 'rfps' });
RFP.belongsTo(User, { foreignKey: 'client_id', as: 'client' });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/v1/rfps', rfpRoutes);
app.use('/api/v1/public', publicRoutes);

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'BuildConnect Pro API 🚀',
    version: '1.0.0',
    status: 'running',
    endpoints: { health: '/health', auth: '/api/v1/auth', rfps: '/api/v1/rfps', admin: '/api/v1/admin' },
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/subscription', subscriptionRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/email', emailRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found', statusCode: 404 } });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: { message: err.message || 'Internal server error', statusCode: err.statusCode || 500 },
  });
});

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected!');
    await sequelize.sync({ alter: true });
    console.log('✅ Database synchronized!');
    
    const adminEmail = 'ibrtoros@unoliva.com';
    const adminUser = await User.findOne({ where: { email: adminEmail } });
    if (adminUser && adminUser.role !== 'admin') {
      await adminUser.update({ role: 'admin' });
      console.log(`👑 Admin role granted to ${adminEmail}`);
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`💚 Health: http://localhost:${PORT}/health`);
      console.log(`👑 Admin: ${adminEmail}`);
    });
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

startServer();
module.exports = app;
