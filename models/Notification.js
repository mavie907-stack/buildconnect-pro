const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: { type: DataTypes.UUID, allowNull: false },
  type:    { type: DataTypes.STRING(50), defaultValue: 'info' },
  title:   { type: DataTypes.STRING(255), allowNull: false },
  body:    { type: DataTypes.TEXT, defaultValue: '' },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'notifications', timestamps: true });

module.exports = Notification;
