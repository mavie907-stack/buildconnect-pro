const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Follow = sequelize.define('Follow', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  follower_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  following_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'follows',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['follower_id', 'following_id'] },
  ],
});

module.exports = Follow;
