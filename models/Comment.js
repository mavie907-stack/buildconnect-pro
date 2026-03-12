const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Comment = sequelize.define('Comment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  post_id:   { type: DataTypes.UUID, allowNull: false },
  author_id: { type: DataTypes.UUID, allowNull: false },
  body:      { type: DataTypes.TEXT, allowNull: false },
}, { tableName: 'comments', timestamps: true });

module.exports = Comment;
