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
const rfpRoutes = require('./routes/rfp');

// Set up model associations
User.hasMany(RFP, { foreignKey: 'client_id', as: 'rfps' });
RFP.belongsTo(User, { foreignKey: 'client_id', as: 'client' });

const app = express();
const PORT = process.env.PORT || 5000;

// Security
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Uploads directory
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Health check
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
    message: 'BuildConnect Pro API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      rfps: '/api/v1/rfps',
    },
  });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rfps', rfpRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found', statusCode: 404 } });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: { message: err.message || 'Internal server error', statusCode: err.statusCode || 500 },
  });
});

// Start server
async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected!');

    await sequelize.sync({ alter: true });
    console.log('✅ Database synchronized!');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`💚 Health: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
