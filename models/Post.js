const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

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
    defaultValue: '',
  },
  // Stored as JSON string: [{ url, type, name, size }]
  media: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() {
      try { return JSON.parse(this.getDataValue('media') || '[]'); } catch { return []; }
    },
    set(val) {
      this.setDataValue('media', JSON.stringify(val || []));
    },
  },
  // Stored as JSON string: [userId, userId, ...]
  likes: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() {
      try { return JSON.parse(this.getDataValue('likes') || '[]'); } catch { return []; }
    },
    set(val) {
      this.setDataValue('likes', JSON.stringify(val || []));
    },
  },
  // Stored as JSON string: { userId: emoji }
  reactions: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
    get() {
      try { return JSON.parse(this.getDataValue('reactions') || '{}'); } catch { return {}; }
    },
    set(val) {
      this.setDataValue('reactions', JSON.stringify(val || {}));
    },
  },
  rfp_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  is_pinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_hidden: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'posts',
  timestamps: true,
});

module.exports = Post;
