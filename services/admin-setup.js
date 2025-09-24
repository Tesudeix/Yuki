const bcrypt = require("bcryptjs");

const AdminUser = require("../models/AdminUser");
const User = require("../models/User");

const DEFAULT_ADMIN_PHONE = "+97699113769";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "10", 10) || 10;

const ADMIN_PHONE = (process.env.ADMIN_PHONE ?? DEFAULT_ADMIN_PHONE).trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;

const normalizeAdminPhone = (value) => {
    if (typeof value !== "string") {
        return "";
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }

    const digits = trimmed.replace(/[^\d+]/g, "");
    if (!digits) {
        return "";
    }

    if (digits.startsWith("+")) {
        return `+${digits.slice(1).replace(/\D/g, "")}`;
    }

    return `+${digits.replace(/\D/g, "")}`;
};

let ensureAdminPromise = null;

const ensureAdminUser = async () => {
    if (ensureAdminPromise) {
        return ensureAdminPromise;
    }

    ensureAdminPromise = (async () => {
        const normalizedPhone = normalizeAdminPhone(ADMIN_PHONE);
        if (!normalizedPhone) {
            throw new Error("ADMIN_PHONE is not configured correctly.");
        }

        const syncUserCredentials = async (passwordHash) => {
            await User.findOneAndUpdate(
                { phone: normalizedPhone },
                {
                    phone: normalizedPhone,
                    passwordHash,
                    hasPassword: true,
                    name: "Админ хэрэглэгч",
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            );
        };

        let admin = await AdminUser.findOne({ phone: normalizedPhone });

        if (!admin) {
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
            admin = await AdminUser.create({
                phone: normalizedPhone,
                passwordHash,
                name: "Админ",
            });

            await syncUserCredentials(passwordHash);
            return admin;
        }

        const passwordMatches = await bcrypt.compare(ADMIN_PASSWORD, admin.passwordHash);
        if (!passwordMatches) {
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
            admin.passwordHash = passwordHash;
            await admin.save();
            await syncUserCredentials(passwordHash);
        } else {
            await syncUserCredentials(admin.passwordHash);
        }

        return admin;
    })()
        .catch((error) => {
            console.error("Failed to ensure admin user", error);
            throw error;
        })
        .finally(() => {
            ensureAdminPromise = null;
        });

    return ensureAdminPromise;
};

module.exports = {
    ADMIN_PHONE,
    ensureAdminUser,
    normalizeAdminPhone,
};
