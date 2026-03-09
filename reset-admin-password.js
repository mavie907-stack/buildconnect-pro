
require('dotenv').config();
const bcrypt    = require('bcryptjs');
const sequelize = require('./config/database');
const User      = require('./models/User');

const NEW_PASSWORD = 'Admin@1234!';
const ADMIN_EMAIL  = 'ibrtoros@unoliva.com';

async function resetPassword() {
  try {
    await sequelize.authenticate();
    const user = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (!user) { console.error('❌ User not found'); process.exit(1); }
    const hash = await bcrypt.hash(NEW_PASSWORD, 10);
    await user.update({ password: hash, role: 'admin' });
    console.log('✅ Password reset! Login with: ' + ADMIN_EMAIL + ' / ' + NEW_PASSWORD);
    process.exit(0);
  } catch(e) { console.error('❌ Error:', e.message); process.exit(1); }
}
resetPassword();
