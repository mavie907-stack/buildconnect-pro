const { SitemapStream, streamToPromise } = require('sitemap');
const { Readable } = require('stream');
const RFP = require('../models/RFP');
const User = require('../models/User');

// Generate sitemap
const generateSitemap = async (req, res) => {
  try {
    const baseUrl = process.env.FRONTEND_URL || 'https://buildconnect-pro.com';
    
    const links = [
      // Static pages
      { url: '/', changefreq: 'daily', priority: 1.0 },
      { url: '/pricing', changefreq: 'monthly', priority: 0.8 },
      { url: '/about', changefreq: 'monthly', priority: 0.7 },
      { url: '/library', changefreq: 'weekly', priority: 0.9 },
      { url: '/blog', changefreq: 'daily', priority: 0.9 },
    ];

    // Get all open projects
    const projects = await RFP.findAll({
      where: { status: 'open' },
      attributes: ['id', 'title', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
      limit: 1000
    });

    // Add project pages
    projects.forEach(project => {
      const slug = createSlug(project.title, project.id);
      links.push({
        url: `/projects/${slug}`,
        changefreq: 'weekly',
        priority: 0.8,
        lastmod: project.updatedAt
      });
    });

    // Get all active professionals
    const professionals = await User.findAll({
      where: { 
        role: 'professional',
        is_active: true 
      },
      attributes: ['id', 'name', 'updatedAt'],
      limit: 500
    });

    // Add professional profile pages
    professionals.forEach(prof => {
      const slug = createSlug(prof.name, prof.id);
      links.push({
        url: `/architects/${slug}`,
        changefreq: 'weekly',
        priority: 0.7,
        lastmod: prof.updatedAt
      });
    });

    // Create sitemap
    const stream = new SitemapStream({ hostname: baseUrl });
    const data = await streamToPromise(Readable.from(links).pipe(stream));
    const sitemap = data.toString();

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);

  } catch (error) {
    console.error('Sitemap generation error:', error);
    res.status(500).send('Error generating sitemap');
  }
};

// Helper function to create URL-friendly slug
function createSlug(title, id) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
  
  return `${slug}-${id.substring(0, 8)}`;
}

module.exports = { generateSitemap, createSlug }

