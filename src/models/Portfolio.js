// src/models/Portfolio.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Portfolio extends Model {}

Portfolio.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  project_type: { type: DataTypes.STRING, allowNull: true },
  location: { type: DataTypes.STRING, allowNull: true },
  completion_date: { type: DataTypes.DATE, allowNull: true },
  project_value: { type: DataTypes.DECIMAL(15,2), allowNull: true },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  // Array of image URLs (Cloudinary)
  images: { type: DataTypes.JSONB, defaultValue: [] },
  is_featured: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { sequelize, tableName: 'portfolios' });

module.exports = Portfolio;
