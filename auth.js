const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Ensure we always have a signing secret; prefer env but fall back to a per-process secret
let secret = process.env.JWT_SECRET;
if (!secret) {
  // Generate a strong ephemeral secret to avoid crashing the app in dev/misconfig
  secret = crypto.randomBytes(48).toString('base64url');
  process.env.JWT_SECRET = secret;
  // eslint-disable-next-line no-console
  console.warn('JWT_SECRET is not set. Using a temporary in-memory secret. Configure JWT_SECRET in .env for stable tokens.');
}

const createToken = (payload, options = {}) =>
  jwt.sign(payload, secret, { expiresIn: '12h', ...options });

const verifyToken = (token) => jwt.verify(token, secret);

module.exports = {
  createToken,
  verifyToken,
};
