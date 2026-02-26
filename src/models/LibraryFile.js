const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');

class LibraryFile extends Model {}

LibraryFile.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // catalogue | architectural | structural | materials | standards
    category: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'catalogue',
    },
    // Full URL to file on Natro server e.g. https://unoliva.com/library/file.pdf
    url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // e.g. PDF, DWG, XLSX
    filetype: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'PDF',
    },
    // e.g. "4.2 MB"
    size: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // pro_only or free
    access: {
      type: DataTypes.STRING,
      defaultValue: 'pro_only',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    download_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    uploaded_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'library_files',
  }
);

module.exports = LibraryFile;
