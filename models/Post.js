const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Post = sequelize.define('Post', {
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
    defaultValue: '',
  },
  media: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() { try { return JSON.parse(this.getDataValue('media') || '[]'); } catch { return []; } },
    set(val) { this.setDataValue('media', JSON.stringify(val || [])); },
  },
  likes: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() { try { return JSON.parse(this.getDataValue('likes') || '[]'); } catch { return []; } },
    set(val) { this.setDataValue('likes', JSON.stringify(val || [])); },
  },
  reactions: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
    get() { try { return JSON.parse(this.getDataValue('reactions') || '{}'); } catch { return {}; } },
    set(val) { this.setDataValue('reactions', JSON.stringify(val || {})); },
  },
  rfp_id: { type: DataTypes.STRING, allowNull: true }, // kept as STRING to avoid ALTER conflicts
  is_pinned: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_hidden: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'posts', timestamps: true });

module.exports = Post;
