const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Library = sequelize.define('Library', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title:       { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  category:    { type: DataTypes.STRING(100), defaultValue: 'catalogue' },
  url:         { type: DataTypes.TEXT, allowNull: false },
  filetype:    { type: DataTypes.STRING(50), defaultValue: 'PDF' },
  size:        { type: DataTypes.STRING(50), defaultValue: '' },
  access:      { type: DataTypes.STRING(50), defaultValue: 'pro_only' },
  is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
  download_count: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'library',
  timestamps: true,
});

module.exports = Library;
