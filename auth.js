const jwt = require('jsonwebtoken');

const { JWT_SECRET } = process.env;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured.');
}

const createToken = (payload, options = {}) =>
    jwt.sign(payload, JWT_SECRET, { expiresIn: '12h', ...options });

const verifyToken = (token) => jwt.verify(token, JWT_SECRET);

module.exports = {
    createToken,
    verifyToken,
};
