const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Badge = sequelize.define('Badge', {
  id         : { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id    : { type: DataTypes.UUID, allowNull: false },
  badge_key  : { type: DataTypes.STRING(100), allowNull: false },
  badge_name : { type: DataTypes.STRING(100), allowNull: false },
  badge_icon : { type: DataTypes.STRING(10),  defaultValue: '🏅' },
  badge_desc : { type: DataTypes.STRING(255), defaultValue: '' },
  awarded_at : { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'badges',
  timestamps: true,
  indexes: [{ unique: true, fields: ['user_id','badge_key'] }],
});

module.exports = Badge;
