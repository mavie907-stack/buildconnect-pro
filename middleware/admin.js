const isAdmin = (req, res, next) => {
  if (!req.userRole || req.userRole !== 'admin') {
    return res.status(403).json({
      success: false,
      error: { message: 'Admin access required', statusCode: 403 },
    });
  }
  next();
};

module.exports = { isAdmin };
