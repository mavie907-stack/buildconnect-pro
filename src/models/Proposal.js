const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Proposal = sequelize.define('Proposal', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  rfp_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  professional_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  cover_letter: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  budget: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  timeline: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'accepted', 'rejected'),
    defaultValue: 'pending',
  },
  attachments: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'proposals',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

module.exports = Proposal;
