const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Invite = require("../models/Invite");

const router = express.Router();

const User = require("../models/User");
const { createToken, verifyToken: verifyJwt } = require("../auth");

const E164_REGEX = /^\+\d{9,15}$/;
const MIN_PASSWORD_LENGTH = 6;
const BCRYPT_ROUNDS = 10;
const DEFAULT_INVITE = (process.env.DEFAULT_INVITE_CODE || "1fs5").trim().toLowerCase();
const ADMIN_FALLBACK_PHONE = (process.env.ADMIN_PHONE || process.env.SUPERADMIN_PHONE || "+97694641031").trim();
const ADMIN_FALLBACK_PASSWORD = (process.env.ADMIN_PASSWORD || "tesu123$").trim();

const sanitizePhone = (phone) => {
    if (typeof phone !== "string") {
        return null;
    }

    const stripped = phone.trim();
    const keepCharacters = stripped.replace(/[^\d+]/g, "");

    if (!keepCharacters) {
        return null;
    }

    if (keepCharacters.startsWith("+")) {
        const normalized = `+${keepCharacters.slice(1).replace(/\D/g, "")}`;
        return E164_REGEX.test(normalized) ? normalized : null;
    }

    const digitsOnly = keepCharacters.replace(/\D/g, "");
    return E164_REGEX.test(`+${digitsOnly}`) ? `+${digitsOnly}` : null;
};

const formatUser = (userDoc) => {
    if (!userDoc) {
        return null;
    }

    const doc = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };

    const { _id, passwordHash, hasPassword } = doc;

    return {
        id: typeof _id?.toString === "function" ? _id.toString() : doc.id ?? null,
        phone: doc.phone,
        name: doc.name ?? null,
        email: doc.email ?? null,
        role: doc.role ?? null,
        classroomAccess: Boolean(doc.classroomAccess),
        age: typeof doc.age === "number" ? doc.age : null,
        avatarUrl: doc.avatarUrl ?? null,
        lastVerifiedAt: doc.lastVerifiedAt ?? null,
        lastLoginAt: doc.lastLoginAt ?? null,
        lastPasswordResetAt: doc.lastPasswordResetAt ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null,
        hasPassword: Boolean(passwordHash) || Boolean(hasPassword),
    };
};

const normalizePassword = (password) => (typeof password === "string" ? password.trim() : "");

const validatePassword = (password) => {
    if (!password) {
        return { ok: false, error: "Password is required" };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return {
            ok: false,
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
        };
    }

    return { ok: true };
};

const mongoStateLabels = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
};

const sendSuccess = (res, status, payload = {}) => res.status(status).json({ success: true, ...payload });
const sendError = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra });
const ensureMongoConnection = (res) => {
    const state = mongoose.connection.readyState;
    if (state !== 1) {
        return sendError(res, 503, "MongoDB connection unavailable", {
            details: mongoStateLabels[state] || "unknown",
        });
    }
    return null;
};

router.get("/status", async (req, res) => {
    const connectionState = mongoose.connection.readyState;
    const mongo = {
        connected: connectionState === 1,
        status: mongoStateLabels[connectionState] || "unknown",
        database: mongoose.connection.name || null,
    };

    return sendSuccess(res, 200, { mongo });
});

const authGuard = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return sendError(res, 401, "No token provided");
        }

        req.user = verifyJwt(token);
        return next();
    } catch (err) {
        return sendError(res, 401, "Unauthorized", { details: err.message });
    }
};

router.post("/register", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);
    const name = typeof req.body.name === "string" ? req.body.name.trim() || undefined : undefined;
    // Free signup flow: ignore invite codes entirely
    const invite = "";
    const INVITES = new Set();
    const REQUIRE = false;

    if (!phone) {
        return sendError(res, 400, "Phone number must be provided in E.164 format (e.g. +15551234567)");
    }

    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    const validation = validatePassword(passwordInput);
    if (!validation.ok) {
        return sendError(res, 400, validation.error);
    }

    // Invite enforcement removed

    try {
        const existing = await User.findOne({ phone }).select("_id");
        if (existing) {
            return sendError(res, 409, "This phone number is already registered");
        }

        const now = new Date();
        const passwordHash = await bcrypt.hash(passwordInput, BCRYPT_ROUNDS);

        const user = await User.create({
            phone,
            name,
            passwordHash,
            hasPassword: true,
            lastLoginAt: now,
            lastVerifiedAt: now,
        });

        // No automatic membership granted at signup (paywall handles premium)

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return sendSuccess(res, 201, { token, user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to register", { details: err.message });
    }
});

router.post("/login", async (req, res) => {
    const phone = sanitizePhone(req.body.phone);
    const passwordInput = normalizePassword(req.body.password);

    if (!phone || !passwordInput) {
        return sendError(res, 400, "Phone number (E.164) and password are required");
    }

    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        let user = await User.findOne({ phone }).select("+passwordHash");

        if (!user || !user.passwordHash) {
            // Fallback: if matches configured admin phone + password, (re)create the user for login
            const adminPhone = sanitizePhone(ADMIN_FALLBACK_PHONE);
            if (adminPhone && phone === adminPhone && passwordInput && passwordInput === ADMIN_FALLBACK_PASSWORD) {
                const passwordHash = await bcrypt.hash(passwordInput, BCRYPT_ROUNDS);
                user = await User.findOneAndUpdate(
                    { phone },
                    { $set: { phone, passwordHash, hasPassword: true, name: "Суперадмин" } },
                    { upsert: true, new: true }
                ).select("+passwordHash");
            } else {
                return sendError(res, 401, "Invalid phone number or password");
            }
        }

        const passwordMatches = await bcrypt.compare(passwordInput, user.passwordHash);

        if (!passwordMatches) {
            return sendError(res, 401, "Invalid phone number or password");
        }

        user.lastLoginAt = new Date();
        user.hasPassword = true;
        await user.save();

        const token = createToken({ phone: user.phone, userId: user._id.toString() });

        return sendSuccess(res, 200, { token, user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to sign in", { details: err.message });
    }
});

router.post("/password/change", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    const currentPassword = normalizePassword(req.body.currentPassword);
    const newPassword = normalizePassword(req.body.newPassword);

    if (!currentPassword || !newPassword) {
        return sendError(res, 400, "Both currentPassword and newPassword are required");
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
        return sendError(res, 400, validation.error);
    }

    try {
        const user = await User.findById(req.user.userId).select("+passwordHash");
        if (!user || !user.passwordHash) {
            return sendError(res, 404, "User not found");
        }

        const matches = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!matches) {
            return sendError(res, 401, "Current password is incorrect");
        }

        user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        user.hasPassword = true;
        user.lastPasswordResetAt = new Date();
        await user.save();

        return sendSuccess(res, 200, {});
    } catch (err) {
        return sendError(res, 500, "Failed to change password", { details: err.message });
    }
});

router.get("/profile", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        const user = await User.findOne({ phone: req.user.phone }).lean();

        if (!user) {
            return sendError(res, 404, "User not found");
        }

        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to load profile", { details: err.message });
    }
});

// Update the authenticated user's avatar URL
// Accepts either Authorization: Bearer <jwt> (preferred) OR X-User-Id header for compatibility
router.patch("/profile/avatar", async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) {
        return mongoGuard;
    }

    try {
        const rawAuth = req.headers.authorization || "";
        const bearer = rawAuth.startsWith("Bearer ") ? rawAuth.slice(7).trim() : null;
        let userId = null;
        if (bearer) {
            try {
                const payload = verifyJwt(bearer);
                userId = payload?.userId || null;
            } catch (e) {
                // ignore and fall back to header
                userId = null;
            }
        }

        if (!userId) {
            const headerId = req.get("x-user-id") || req.get("X-User-Id");
            userId = headerId ? String(headerId).trim() : null;
        }

        if (!userId) {
            return sendError(res, 401, "Missing user identity");
        }

        const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl.trim() : "";
        if (!avatarUrl) {
            return sendError(res, 400, "avatarUrl is required");
        }

        // Accept either ObjectId or string ids
        let query;
        if (mongoose.Types.ObjectId.isValid(userId)) {
            query = { _id: new mongoose.Types.ObjectId(userId) };
        } else {
            query = { _id: userId };
        }

        const user = await User.findOneAndUpdate(
            query,
            { $set: { avatarUrl } },
            { new: true },
        );

        if (!user) {
            return sendError(res, 404, "User not found");
        }

        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to update avatar", { details: err.message });
    }
});

// --- Superadmin utilities ---
const superAdmins = new Set([
    process.env.ADMIN_PHONE || process.env.SUPERADMIN_PHONE || "+97694641031",
]);
const isSuperAdminPhone = (phone) => (phone ? superAdmins.has(String(phone)) : false);

// DELETE /users/admin/:id  (superadmin only)
router.delete("/admin/:id", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const callerPhone = req.user?.phone;
        if (!isSuperAdminPhone(callerPhone)) {
            return sendError(res, 403, "Forbidden");
        }
        const { id } = req.params;
        const user = await User.findByIdAndDelete(id);
        if (!user) return sendError(res, 404, "User not found");
        return sendSuccess(res, 200, {});
    } catch (err) {
        return sendError(res, 500, "Failed to delete user", { details: err.message });
    }
});

// POST /users/admin/grant-classroom  (superadmin only)
// Body: { phone: string, access?: boolean }
router.post("/admin/grant-classroom", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const callerPhone = req.user?.phone;
        if (!isSuperAdminPhone(callerPhone)) {
            return sendError(res, 403, "Forbidden");
        }
        const rawPhone = req.body?.phone;
        const access = typeof req.body?.access === "boolean" ? req.body.access : true;
        const phone = sanitizePhone(String(rawPhone || ""));
        if (!phone) return sendError(res, 400, "Valid phone is required");
        const user = await User.findOneAndUpdate(
            { phone },
            { $set: { classroomAccess: access } },
            { new: true },
        );
        if (!user) return sendError(res, 404, "User not found");
        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to update classroom access", { details: err.message });
    }
});

// PUT /users/admin/:id (superadmin only) — edit member
// Body: { name?: string, classroomAccess?: boolean, extendDays?: number, membershipExpiresAt?: string }
router.put("/admin/:id", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const callerPhone = req.user?.phone;
        if (!isSuperAdminPhone(callerPhone)) {
            return sendError(res, 403, "Forbidden");
        }
        const { id } = req.params;
        const user = await User.findById(id);
        if (!user) return sendError(res, 404, "User not found");
        const now = new Date();
        const { name, classroomAccess, extendDays, membershipExpiresAt } = req.body || {};
        if (typeof name === "string") user.name = name.trim();
        if (typeof classroomAccess === "boolean") user.classroomAccess = classroomAccess;
        if (typeof membershipExpiresAt === "string" && membershipExpiresAt.trim()) {
            const d = new Date(membershipExpiresAt);
            if (!Number.isNaN(d.getTime())) user.membershipExpiresAt = d;
        }
        const days = parseInt(String(extendDays ?? "0"), 10) || 0;
        if (days > 0) {
            const base = user.membershipExpiresAt && user.membershipExpiresAt > now ? user.membershipExpiresAt : now;
            user.membershipExpiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
            user.classroomAccess = true;
        }
        await user.save();
        return sendSuccess(res, 200, { user: formatUser(user) });
    } catch (err) {
        return sendError(res, 500, "Failed to update user", { details: err.message });
    }
});

// Public members list with count
// GET /users/members?limit=200&page=1&q=
router.get("/members", async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const limit = Math.max(parseInt(String(req.query.limit || "200"), 10) || 200, 1);
        const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
        const skip = (page - 1) * limit;
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const filter = q
            ? {
                $or: [
                    { name: { $regex: q, $options: "i" } },
                    { phone: { $regex: q.replace(/[^\d+]/g, ""), $options: "i" } },
                ],
            }
            : {};

        const [total, members] = await Promise.all([
            User.countDocuments(filter),
            User.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select("_id name phone avatarUrl createdAt")
                .lean(),
        ]);

        return res.json({ total, page, limit, members: members.map((m) => ({
            id: String(m._id),
            name: m.name || null,
            phone: m.phone || null,
            avatarUrl: m.avatarUrl || null,
            createdAt: m.createdAt || null,
        })) });
    } catch (err) {
        return sendError(res, 500, "Failed to load members", { details: err.message });
    }
});



// --- Invite code management (superadmin) ---
const randomCode = (len = 8) => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid ambiguous chars
    let out = "";
    for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
};

// POST /users/admin/invites { count?: number, days?: number }
router.post("/admin/invites", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const callerPhone = req.user?.phone;
        if (!isSuperAdminPhone(callerPhone)) return sendError(res, 403, "Forbidden");
        const count = Math.min(Math.max(parseInt(String(req.body?.count ?? "1"), 10) || 1, 1), 100);
        const days = Math.max(parseInt(String(req.body?.days ?? "30"), 10) || 30, 1);
        const docs = [];
        for (let i = 0; i < count; i += 1) {
            const code = randomCode(8);
            docs.push({ code, codeLower: code.toLowerCase(), maxUses: 1, uses: 0, days });
        }
        const created = await Invite.insertMany(docs, { ordered: false }).catch(async () => {
            const fresh = [];
            for (const _ of docs) {
                let ok = false;
                for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
                    const code = randomCode(8);
                    try {
                        const one = await Invite.create({ code, codeLower: code.toLowerCase(), maxUses: 1, uses: 0, days });
                        fresh.push(one);
                        ok = true;
                    } catch (_) { /* collision retry */ }
                }
            }
            return fresh;
        });
        return sendSuccess(res, 201, { invites: created.map((d) => ({ code: d.code, days: d.days })) });
    } catch (err) {
        return sendError(res, 500, "Failed to create invites", { details: err.message });
    }
});

// GET /users/admin/invites?status=unused|used
router.get("/admin/invites", authGuard, async (req, res) => {
    const mongoGuard = ensureMongoConnection(res);
    if (mongoGuard) return mongoGuard;
    try {
        const callerPhone = req.user?.phone;
        if (!isSuperAdminPhone(callerPhone)) return sendError(res, 403, "Forbidden");
        const status = String(req.query?.status || "").toLowerCase();
        const filter = status === "used" ? { uses: { $gte: 1 } } : status === "unused" ? { uses: { $lt: 1 } } : {};
        const items = await Invite.find(filter).sort({ createdAt: -1 }).limit(500).lean();
        return sendSuccess(res, 200, { invites: items.map((i) => ({ code: i.code, uses: i.uses, days: i.days, usedAt: i.usedAt || null })) });
    } catch (err) {
        return sendError(res, 500, "Failed to list invites", { details: err.message });
    }
});

module.exports = router;
