const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Post = sequelize.define('Post', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  author_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  image_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  likes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  comments_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'posts',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

module.exports = Post;
