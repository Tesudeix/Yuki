const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { createToken, verifyToken } = require("../auth");
const AdminUser = require("../models/AdminUser");
const User = require("../models/User");
const Location = require("../models/Location");
const Artist = require("../models/Artist");
const Booking = require("../models/Booking");

const router = express.Router();

const ADMIN_PHONE = "+97699113769";
const ADMIN_PASSWORD = "admin123";
const BCRYPT_ROUNDS = 10;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const slugify = (value) =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

let ensureAdminPromise = null;

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

const ensureAdminUser = async () => {
    if (ensureAdminPromise) {
        return ensureAdminPromise;
    }

    ensureAdminPromise = (async () => {
        const normalizedPhone = normalizeAdminPhone(ADMIN_PHONE);

        let admin = await AdminUser.findOne({ phone: normalizedPhone });

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
        })
        .finally(() => {
            ensureAdminPromise = null;
        });

    return ensureAdminPromise;
};

const requireAdminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ success: false, error: "Админ эрхээр нэвтэрнэ үү." });
        }

        const payload = verifyToken(token);
        if (payload.role !== "admin" || !payload.adminId) {
            return res.status(403).json({ success: false, error: "Эрх хүрэлцэхгүй байна." });
        }

        req.admin = payload;
        return next();
    } catch (err) {
        return res.status(401).json({ success: false, error: "Админ эрхээр нэвтрэх шаардлагатай.", details: err.message });
    }
};

const toAdminArtistDto = (artistDoc) => ({
    id: artistDoc._id.toString(),
    name: artistDoc.name,
    bio: artistDoc.bio || null,
    specialties: Array.isArray(artistDoc.specialties) ? artistDoc.specialties : [],
    avatarUrl: artistDoc.avatarUrl || null,
    locations: Array.isArray(artistDoc.locations)
        ? artistDoc.locations.map((location) => (
            location && location._id
                ? { id: location._id.toString(), name: location.name }
                : { id: location?.toString?.() ?? "", name: "" }
        ))
        : [],
    active: artistDoc.active,
});

router.post("/login", async (req, res) => {
    const phone = normalizeAdminPhone(req.body?.phone);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!phone) {
        return res.status(400).json({ success: false, error: "Утасны дугаараа зөв оруулна уу." });
    }

    await ensureAdminUser();

    try {
        const admin = await AdminUser.findOne({ phone });
        if (!admin) {
            return res.status(401).json({ success: false, error: "Буруу утас эсвэл нууц үг." });
        }

        const matches = await bcrypt.compare(password, admin.passwordHash);
        if (!matches) {
            return res.status(401).json({ success: false, error: "Буруу утас эсвэл нууц үг." });
        }

        admin.lastLoginAt = new Date();
        await admin.save();

        const token = createToken({ adminId: admin._id.toString(), role: "admin" }, { expiresIn: "8h" });

        return res.json({
            success: true,
            token,
            admin: {
                id: admin._id.toString(),
                phone: admin.phone,
                name: admin.name,
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Нэвтрэхэд алдаа гарлаа.", details: err.message });
    }
});

router.use(requireAdminAuth);

router.get("/locations", async (req, res) => {
    try {
        const locations = await Location.find({}).sort({ order: 1, name: 1 }).lean();
        return res.json({ success: true, locations });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Салон ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.post("/locations", async (req, res) => {
    const { name, city, district, address, phone, workingHours, description } = req.body || {};

    if (!name) {
        return res.status(400).json({ success: false, error: "Салоны нэрийг заавал оруулна уу." });
    }

    try {
        const slug = slugify(name);
        const location = await Location.create({
            name,
            slug,
            city,
            district,
            address,
            phone,
            workingHours,
            description,
        });

        return res.status(201).json({ success: true, location });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Салон үүсгэхэд алдаа гарлаа.", details: err.message });
    }
});

router.put("/locations/:locationId", async (req, res) => {
    const { locationId } = req.params;

    if (!isValidObjectId(locationId)) {
        return res.status(400).json({ success: false, error: "Салон ID буруу байна." });
    }

    const updates = (({ name, city, district, address, phone, workingHours, description, active }) => ({
        name,
        city,
        district,
        address,
        phone,
        workingHours,
        description,
        active,
    }))(req.body || {});

    if (updates.name) {
        updates.slug = slugify(updates.name);
    }

    try {
        const location = await Location.findByIdAndUpdate(locationId, updates, { new: true });
        if (!location) {
            return res.status(404).json({ success: false, error: "Салон олдсонгүй." });
        }
        return res.json({ success: true, location });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Салон шинэчлэхэд алдаа гарлаа.", details: err.message });
    }
});

router.delete("/locations/:locationId", async (req, res) => {
    const { locationId } = req.params;

    if (!isValidObjectId(locationId)) {
        return res.status(400).json({ success: false, error: "Салон ID буруу байна." });
    }

    try {
        const linkedArtists = await Artist.countDocuments({ locations: locationId });
        if (linkedArtists > 0) {
            return res.status(409).json({ success: false, error: "Энэ салонтой холбогдсон артистуудыг эхлээд өөрчлөнө үү." });
        }

        await Location.findByIdAndDelete(locationId);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Салон устгахад алдаа гарлаа.", details: err.message });
    }
});

router.get("/artists", async (req, res) => {
    try {
        const artists = await Artist.find({}).sort({ name: 1 }).populate("locations");
        return res.json({ success: true, artists: artists.map(toAdminArtistDto) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артистуудыг ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.post("/artists", async (req, res) => {
    const { name, bio, specialties, locationIds, avatarUrl, active = true } = req.body || {};

    if (!name) {
        return res.status(400).json({ success: false, error: "Артистын нэр шаардлагатай." });
    }

    const validLocations = Array.isArray(locationIds)
        ? locationIds.filter((id) => typeof id === "string" && isValidObjectId(id))
        : [];
 
    try {
        const artist = await Artist.create({
            name,
            bio,
            specialties: Array.isArray(specialties) ? specialties : [],
            avatarUrl,
            locations: validLocations,
            active,
        });
        await artist.populate("locations");
        return res.status(201).json({ success: true, artist: toAdminArtistDto(artist) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артист нэмэхэд алдаа гарлаа.", details: err.message });
    }
});

router.put("/artists/:artistId", async (req, res) => {
    const { artistId } = req.params;

    if (!isValidObjectId(artistId)) {
        return res.status(400).json({ success: false, error: "Артист ID буруу байна." });
    }

    const { name, bio, specialties, avatarUrl, active, locationIds } = req.body || {};

    const updates = {
        name,
        bio,
        specialties,
        avatarUrl,
        active,
    };

    if (Array.isArray(updates.specialties)) {
        updates.specialties = updates.specialties.filter(Boolean);
    }

    const validLocationIds = Array.isArray(locationIds)
        ? locationIds.filter((id) => typeof id === "string" && isValidObjectId(id))
        : undefined;

    try {
        const artist = await Artist.findByIdAndUpdate(
            artistId,
            {
                ...updates,
                ...(validLocationIds ? { locations: validLocationIds } : {}),
            },
            { new: true },
        ).populate("locations");
        if (!artist) {
            return res.status(404).json({ success: false, error: "Артист олдсонгүй." });
        }
        return res.json({ success: true, artist: toAdminArtistDto(artist) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артист шинэчлэхэд алдаа гарлаа.", details: err.message });
    }
});

router.delete("/artists/:artistId", async (req, res) => {
    const { artistId } = req.params;

    if (!isValidObjectId(artistId)) {
        return res.status(400).json({ success: false, error: "Артист ID буруу байна." });
    }

    try {
        const existingBookings = await Booking.countDocuments({ artist: artistId });
        if (existingBookings > 0) {
            return res.status(409).json({ success: false, error: "Энэ артист захиалгатай тул шууд устгах боломжгүй." });
        }

        await Artist.findByIdAndDelete(artistId);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артист устгахад алдаа гарлаа.", details: err.message });
    }
});

router.post("/artists/:artistId/locations", async (req, res) => {
    const { artistId } = req.params;
    const locationIds = Array.isArray(req.body?.locationIds) ? req.body.locationIds : [];

    if (!isValidObjectId(artistId)) {
        return res.status(400).json({ success: false, error: "Артист ID буруу байна." });
    }

    const validLocationIds = locationIds.filter((id) => typeof id === "string" && isValidObjectId(id));

    try {
        const existingLocations = await Location.countDocuments({ _id: { $in: validLocationIds } });
        if (existingLocations !== validLocationIds.length) {
            return res.status(400).json({ success: false, error: "Сонгосон салонуудаас зарим нь олдсонгүй." });
        }

        const artist = await Artist.findByIdAndUpdate(
            artistId,
            { locations: validLocationIds },
            { new: true },
        ).populate("locations");

        if (!artist) {
            return res.status(404).json({ success: false, error: "Артист олдсонгүй." });
        }

        return res.json({ success: true, artist: toAdminArtistDto(artist) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артистын салон тохируулахад алдаа гарлаа.", details: err.message });
    }
});

router.get("/analytics/artists", async (req, res) => {
    const start = typeof req.query?.start === "string" ? new Date(req.query.start) : null;
    const end = typeof req.query?.end === "string" ? new Date(req.query.end) : null;

    const matchStage = { status: "confirmed" };
    if (start && !Number.isNaN(start.getTime())) {
        matchStage.createdAt = { ...(matchStage.createdAt || {}), $gte: start };
    }
    if (end && !Number.isNaN(end.getTime())) {
        matchStage.createdAt = { ...(matchStage.createdAt || {}), $lte: end };
    }

    try {
        const stats = await Booking.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: "$artist",
                    totalBookings: { $sum: 1 },
                    latestBooking: { $max: "$createdAt" },
                },
            },
            {
                $lookup: {
                    from: "artists",
                    localField: "_id",
                    foreignField: "_id",
                    as: "artist",
                },
            },
            { $unwind: "$artist" },
            {
                $project: {
                    id: "$_id",
                    name: "$artist.name",
                    totalBookings: 1,
                    latestBooking: 1,
                },
            },
            { $sort: { totalBookings: -1 } },
        ]);

        return res.json({ success: true, stats });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Статистик ачаалахад алдаа гарлаа.", details: err.message });
    }
});

ensureAdminUser().catch(() => undefined);

module.exports = router;
