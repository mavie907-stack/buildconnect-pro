const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class RFP extends Model {}

RFP.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    client_id: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    industry: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
    project_type: { type: DataTypes.STRING, allowNull: false },
    budget_min: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    budget_max: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    currency: { type: DataTypes.STRING(3), defaultValue: 'USD' },
    location: { type: DataTypes.JSONB, defaultValue: { remote: false } },
    timeline: { type: DataTypes.JSONB, defaultValue: {} },
    deliverables: { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [] },
    attachments: { type: DataTypes.JSONB, defaultValue: [] },
    privacy_level: {
      type: DataTypes.ENUM('public', 'private', 'invite_only'),
      defaultValue: 'public',
    },
    proposal_deadline: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('draft', 'open', 'in_review', 'awarded', 'completed', 'cancelled'),
      defaultValue: 'draft',
    },
    view_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    featured: { type: DataTypes.BOOLEAN, defaultValue: false },
    published_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'rfps',
  }
);

module.exports = RFP;
