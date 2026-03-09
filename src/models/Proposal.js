const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class Proposal extends Model {}

Proposal.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    rfp_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    professional_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    cover_letter: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    budget: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    timeline: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'withdrawn'),
      defaultValue: 'pending',
    },
    attachments: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
  },
  {
    sequelize,
    tableName: 'proposals',
  }
);

module.exports = Proposal;
