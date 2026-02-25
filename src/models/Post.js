const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Post extends Model {}

Post.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    rfp_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Stores uploaded image objects: [{ type:'image', url:'/uploads/...', name:'...' }]
    media: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    // Stores array of user IDs who liked the post
    likes: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    // Stores comment objects: [{ id, author:{ id, name, role }, body, createdAt }]
    comments: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    is_pinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_featured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    view_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'posts',
    // Adds createdAt and updatedAt automatically
  }
);

module.exports = Post;
