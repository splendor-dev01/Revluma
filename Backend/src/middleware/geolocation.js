const geoip = require('geoip-lite');
const maxmind = require('maxmind'); 

module.exports = (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
  const geo = geoip.lookup(ip) || { country: 'US', region: 'CA' };

  req.geo = {
    country: geo.country,
    region: geo.region,
    city: geo.city,
    currency: getCurrency(geo.country),
    taxRate: getTaxRate(geo.country),
    shippingEstimate(cartValue) {
      return Math.max(5, cartValue * 0.05);
    }
  };

  next();
};

function getCurrency(country) {
  const map = { 'US': 'USD', 'NG': 'NGN', 'GB': 'GBP', 'DE': 'EUR', 'default': 'USD' };
  return map[country] || map.default;
}

function getTaxRate(country) {
  const map = { 'US': 0.08, 'CA': 0.13, 'EU': 0.19, 'NG': 0.075 };
  return map[country] || 0.08;
};

