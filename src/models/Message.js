const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');
class Message extends Model {}
Message.init({
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sender_id:   { type: DataTypes.UUID, allowNull: false },
  receiver_id: { type: DataTypes.UUID, allowNull: false },
  content:     { type: DataTypes.TEXT, allowNull: false },
  is_read:     { type: DataTypes.BOOLEAN, defaultValue: false },
  rfp_id:      { type: DataTypes.UUID, allowNull: true },
},{ sequelize, tableName: 'messages' });
module.exports = Message;
