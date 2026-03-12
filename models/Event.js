const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Event = sequelize.define('Event', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title:       { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  date:        { type: DataTypes.DATEONLY, allowNull: false },
  location:    { type: DataTypes.STRING(255), defaultValue: '' },
  rsvps: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() { try { return JSON.parse(this.getDataValue('rsvps') || '[]'); } catch { return []; } },
    set(val) { this.setDataValue('rsvps', JSON.stringify(val || [])); },
  },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'events', timestamps: true });

module.exports = Event;
