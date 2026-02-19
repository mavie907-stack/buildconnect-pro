const User = require('../models/User');

// Send bulk email to users (admin only)
const sendBulkEmail = async (req, res) => {
  try {
    const { subject, message, recipients } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Subject and message are required' }
      });
    }

    let userEmails = [];
    let whereClause = { is_active: true };

    // Filter by recipient type
    if (recipients === 'clients') {
      whereClause.role = 'client';
    } else if (recipients === 'professionals') {
      whereClause.role = 'professional';
    }
    // 'all' = no additional filter

    const users = await User.findAll({ 
      where: whereClause,
      attributes: ['email', 'name', 'role'] 
    });

    userEmails = users.map(u => ({
      email: u.email,
      name: u.name,
      role: u.role
    }));

    // TODO: Integrate with email service (SendGrid, Mailgun, AWS SES)
    // For now, just return the recipient list
    
    console.log(`📧 BULK EMAIL - Would send to ${userEmails.length} users`);
    console.log(`Subject: ${subject}`);
    console.log(`Recipients type: ${recipients || 'all'}`);

    res.json({
      success: true,
      data: {
        recipientCount: userEmails.length,
        recipients: userEmails,
        subject,
        message,
        status: 'Ready to send (email service integration pending)'
      },
      message: `Email prepared for ${userEmails.length} users. Integrate email service to send.`
    });

  } catch (error) {
    console.error('Bulk email error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to prepare bulk email' }
    });
  }
};

// Get email templates
const getEmailTemplates = async (req, res) => {
  try {
    const templates = [
      {
        id: 'welcome',
        name: 'Welcome Message',
        subject: 'Welcome to BuildConnect Pro! 🎉',
        body: `Hi {{name}},

Welcome to BuildConnect Pro - the premier architecture marketplace!

We're excited to have you join our community of architects, designers, and project owners.

Get started by:
• Completing your profile
• Browsing open projects
• Posting your first RFP

Best regards,
The BuildConnect Pro Team`
      },
      {
        id: 'announcement',
        name: 'Platform Announcement',
        subject: 'Important Update from BuildConnect Pro',
        body: `Hi {{name}},

We have an important announcement to share with our community.

[Your announcement here]

Thank you for being part of BuildConnect Pro!

Best regards,
Ibrahim Toros
BuildConnect Pro`
      },
      {
        id: 'promotion',
        name: 'Upgrade Promotion',
        subject: '🎁 Limited Time Offer - Upgrade Your Plan',
        body: `Hi {{name}},

For a limited time, upgrade to our Annual plan and save 43%!

Annual Plan Benefits:
✓ Unlimited project posts
✓ Featured profile badge
✓ Advanced analytics
✓ Priority support

Upgrade today: https://buildconnect-pro.com/pricing

Best regards,
The BuildConnect Pro Team`
      },
      {
        id: 'monthly-update',
        name: 'Monthly Newsletter',
        subject: 'BuildConnect Pro - Monthly Update',
        body: `Hi {{name}},

Here's what's new this month at BuildConnect Pro:

📊 Platform Stats:
• X new projects posted
• Y active professionals
• Z successful connections

🎯 Featured Projects:
[Highlight 2-3 interesting projects]

Thank you for being part of our community!

Best regards,
The BuildConnect Pro Team`
      }
    ];

    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to load templates' }
    });
  }
};

module.exports = {
  sendBulkEmail,
  getEmailTemplates
};
