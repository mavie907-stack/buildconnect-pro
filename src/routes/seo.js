const { Router } = require('express');
const { generateSitemap } = require('../controllers/seo');

const router = Router();

// Sitemap
router.get('/sitemap.xml', generateSitemap);

// robots.txt
router.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://buildconnect-pro.com';
  
  const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml`;

  res.type('text/plain');
  res.send(robots);
});

module.exports = router;
