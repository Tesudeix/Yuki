const jwt = require("jsonwebtoken");
const crypto = require("crypto");

/**
 * JWT SECRET
 * - MUST be stable across restarts in prod
 * - fallback only for local dev
 */
let secret = process.env.JWT_SECRET;

if (!secret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }

  secret = crypto.randomBytes(48).toString("base64url");
  process.env.JWT_SECRET = secret;
  console.warn(
      "[WARN] JWT_SECRET not set. Using temporary in-memory secret (DEV ONLY)."
  );
}

const DEFAULT_OPTIONS = {
  expiresIn: "12h",
  algorithm: "HS256",
  issuer: "yuki-backend",
};

/**
 * Create JWT
 * payload MUST include:
 * - userId OR adminId
 * - role
 */
const createToken = (payload, options = {}) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("JWT payload must be an object");
  }

  if (!payload.role) {
    throw new Error("JWT payload must include role");
  }

  if (!payload.userId && !payload.adminId) {
    throw new Error("JWT payload must include userId or adminId");
  }

  return jwt.sign(payload, secret, {
    ...DEFAULT_OPTIONS,
    ...options,
  });
};

/**
 * Verify JWT
 */
const verifyToken = (token) => {
  if (!token) throw new Error("Missing token");

  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "yuki-backend",
  });
};

module.exports = {
  createToken,
  verifyToken,
};
