const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh';

const generateTokens = (userId, email, role) => {
  const accessToken = jwt.sign({ userId, email, role }, JWT_SECRET, { expiresIn: '7d' });
  const refreshToken = jwt.sign({ userId, email, role }, JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
};

const register = async (req, res) => {
  try {
    const { email, password, name, role, company, location } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email, password and name are required', statusCode: 400 },
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: { message: 'Password must be at least 8 characters', statusCode: 400 },
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already registered', statusCode: 409 },
      });
    }

    const user = await User.create({ email, password, name, role: role || 'professional', company, location });
    const tokens = generateTokens(user.id, user.email, user.role);

    res.status(201).json({
      success: true,
      data: { user: user.toPublicJSON(), ...tokens },
      message: 'Registration successful',
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Registration failed', statusCode: 500 },
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email and password are required', statusCode: 400 },
      });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', statusCode: 401 },
      });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', statusCode: 401 },
      });
    }

    await user.update({ last_login_at: new Date() });
    const tokens = generateTokens(user.id, user.email, user.role);

    res.json({
      success: true,
      data: { user: user.toPublicJSON(), ...tokens },
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Login failed', statusCode: 500 },
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: { message: 'Refresh token required', statusCode: 400 },
      });
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = await User.findByPk(decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid refresh token', statusCode: 401 },
      });
    }

    const tokens = generateTokens(user.id, user.email, user.role);
    res.json({ success: true, data: tokens });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: { message: 'Invalid refresh token', statusCode: 401 },
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found', statusCode: 404 } });
    }
    res.json({ success: true, data: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to get profile', statusCode: 500 } });
  }
};

const updateMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found', statusCode: 404 } });
    }
    const { name, company, location, bio } = req.body;
    await user.update({ name, company, location, bio });
    res.json({ success: true, data: user.toPublicJSON(), message: 'Profile updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to update profile', statusCode: 500 } });
  }
};

const logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};

module.exports = { register, login, refreshToken, getMe, updateMe, logout };
