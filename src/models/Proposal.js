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
      allowNull: false,
    },
    proposed_budget: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: 'USD',
    },
    estimated_duration: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    relevant_experience: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    proposed_team: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Bill of Quantities items: [{ id, desc, qty, unit, unitPrice }]
    boq_items: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    boq_total: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('submitted', 'reviewed', 'accepted', 'rejected'),
      defaultValue: 'submitted',
    },
  },
  {
    sequelize,
    tableName: 'proposals',
  }
);

module.exports = Proposal;
