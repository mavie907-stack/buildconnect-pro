const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: 'No token provided', statusCode: 401 },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: { message: 'User not found or inactive', statusCode: 401 },
      });
    }

    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid token', statusCode: 401 },
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      req.userId = decoded.userId;
      req.userRole = decoded.role;
    }
  } catch (error) {
    // Optional auth - ignore errors
  }
  next();
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions', statusCode: 403 },
      });
    }
    next();
  };
};

module.exports = { authenticate, optionalAuth, authorize };
