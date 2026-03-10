const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');
class Notification extends Model {}
Notification.init({
  id:      { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id: { type: DataTypes.UUID, allowNull: false },
  type:    { type: DataTypes.STRING, allowNull: false },
  title:   { type: DataTypes.STRING, allowNull: true },
  message: { type: DataTypes.TEXT,   allowNull: true },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
  data:    { type: DataTypes.JSON,   defaultValue: {} },
},{ sequelize, tableName: 'notifications' });
module.exports = Notification;
