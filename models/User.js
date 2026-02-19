const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

class User extends Model {
  async comparePassword(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
  }

  toPublicJSON() {
    const values = this.toJSON();
    delete values.password;
    return values;
  }
  User.init(
  {
    id: {
      subscription_tier: {
  type: DataTypes.ENUM('free', 'monthly', 'annual'),
  defaultValue: 'free',
},
subscription_status: {
  type: DataTypes.ENUM('active', 'cancelled', 'expired'),
  defaultValue: 'active',
},
subscription_start: {
  type: DataTypes.DATE,
  allowNull: true,
},
subscription_end: {
  type: DataTypes.DATE,
  allowNull: true,
},
stripe_customer_id: {
  type: DataTypes.STRING,
  allowNull: true,
},
stripe_subscription_id: {
  type: DataTypes.STRING,
  allowNull: true,
},
    role: {
      type: DataTypes.ENUM('client', 'professional', 'admin'),
      defaultValue: 'professional',
    },
    company: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    bio: { type: DataTypes.TEXT, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    is_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'users',
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      },
    },
  }
);

module.exports = User;
