// src/models/Review.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Review extends Model {}

Review.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  // Who is being reviewed (professional)
  reviewee_id: { type: DataTypes.UUID, allowNull: false },
  // Who wrote the review (client)
  reviewer_id: { type: DataTypes.UUID, allowNull: false },
  // Optional: linked to an RFP
  rfp_id: { type: DataTypes.UUID, allowNull: true },
  // Overall rating 1-5
  rating_overall: { type: DataTypes.INTEGER, allowNull: false },
  // Detailed criteria 1-5
  rating_quality: { type: DataTypes.INTEGER, allowNull: true },
  rating_communication: { type: DataTypes.INTEGER, allowNull: true },
  rating_timeline: { type: DataTypes.INTEGER, allowNull: true },
  // Written review
  body: { type: DataTypes.TEXT, allowNull: false },
  // Admin moderation
  is_approved: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, tableName: 'reviews' });

module.exports = Review;
