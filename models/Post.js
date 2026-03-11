const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Post extends Model {}

Post.init({
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  author_id:      { type: DataTypes.UUID, allowNull: false },
  title:          { type: DataTypes.STRING, allowNull: true },
  content:        { type: DataTypes.TEXT, allowNull: true },
  type:           { type: DataTypes.ENUM('update', 'announcement', 'news', 'general'), defaultValue: 'general' },
  status:         { type: DataTypes.ENUM('active', 'hidden', 'deleted'), defaultValue: 'active' },
  image_url:      { type: DataTypes.STRING, allowNull: true },
  likes_count:    { type: DataTypes.INTEGER, defaultValue: 0 },
  comments_count: { type: DataTypes.INTEGER, defaultValue: 0 },
}, { sequelize, tableName: 'posts' });

module.exports = Post;
