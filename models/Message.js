const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  sender_id:   { type: DataTypes.UUID, allowNull: false },
  receiver_id: { type: DataTypes.UUID, allowNull: false },
  subject:     { type: DataTypes.STRING(255), defaultValue: '' },
  body:        { type: DataTypes.TEXT, allowNull: false },
  is_read:     { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'messages', timestamps: true });

module.exports = Message;
