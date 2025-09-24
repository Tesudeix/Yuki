const express = require("express");
const mongoose = require("mongoose");

const Location = require("../models/Location");
const Artist = require("../models/Artist");
const ArtistAvailability = require("../models/ArtistAvailability");
const Booking = require("../models/Booking");
const { verifyToken } = require("../auth");

const router = express.Router();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toLocationDto = (doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    city: doc.city || null,
    district: doc.district || null,
    address: doc.address || null,
    phone: doc.phone || null,
    workingHours: doc.workingHours || null,
    description: doc.description || null,
    imageUrl: doc.imageUrl || null,
});

const toArtistDto = (doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    bio: doc.bio || null,
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    avatarUrl: doc.avatarUrl || null,
});

const toAvailabilityDto = (doc) => ({
    date: doc.date,
    slots: (doc.slots || []).map((slot) => ({
        time: slot.time,
        available: slot.isBooked !== true,
    })),
});

const toBookingDto = (bookingDoc) => ({
    id: bookingDoc._id.toString(),
    status: bookingDoc.status,
    date: bookingDoc.date,
    time: bookingDoc.time,
    timeslot: bookingDoc.timeslot,
    location: bookingDoc.location && bookingDoc.location._id
        ? { id: bookingDoc.location._id.toString(), name: bookingDoc.location.name }
        : { id: bookingDoc.location?.toString?.() ?? "", name: bookingDoc.locationName ?? "" },
    artist: bookingDoc.artist && bookingDoc.artist._id
        ? { id: bookingDoc.artist._id.toString(), name: bookingDoc.artist.name }
        : { id: bookingDoc.artist?.toString?.() ?? "", name: bookingDoc.artistName ?? "" },
    createdAt: bookingDoc.createdAt?.toISOString?.() ?? null,
});

const requireAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "Эрх шаардлагатай" });
        }

        req.user = verifyToken(token);
        return next();
    } catch (err) {
        return res.status(401).json({ error: "Нэвтрэх шаардлагатай", details: err.message });
    }
};

let seedingPromise = null;

const slotTemplate = ["10:00", "11:30", "14:00", "16:00", "18:00"];

const ensureDemoData = async () => {
    if (seedingPromise) {
        return seedingPromise;
    }

    seedingPromise = (async () => {
        const existing = await Location.countDocuments();
        if (existing > 0) {
            return;
        }

        const [central, riverside] = await Location.create([
            {
                name: "Downtown Glam Studio",
                slug: "downtown-glam",
                city: "Улаанбаатар",
                district: "Сүхбаатар",
                address: "СБД, 1-р хороо, Энхтайвны өргөн чөлөө",
                phone: "7010-1234",
                workingHours: "Даваа-Ням 10:00 - 20:00",
                description: "Хотын төвд байрлах, үс засалт болон нүүр будалтын студи.",
                order: 1,
            },
            {
                name: "Riverside Beauty Loft",
                slug: "riverside-beauty",
                city: "Улаанбаатар",
                district: "Баянзүрх",
                address: "БЗД, 3-р хороо, Амар амгалангийн гудамж",
                phone: "7010-5678",
                workingHours: "Даваа-Ням 11:00 - 21:00",
                description: "Усны эрэг дагуух тайван орчин бүхий салон.",
                order: 2,
            },
        ]);

        const [naraa, temuujin, khishgee] = await Artist.create([
            {
                name: "Нараа",
                bio: "10+ жилийн туршлагатай мастер стилист.",
                specialties: ["Үс засалт", "Будалт"],
                locations: [central._id],
            },
            {
                name: "Тэмүүжин",
                bio: "Грэмж, balayage зэрэг техникийн мэргэшилтэй.",
                specialties: ["Үс будалт", "Эрэгтэй засалт"],
                locations: [central._id, riverside._id],
            },
            {
                name: "Хишигээ",
                bio: "Нүүр будалт, хөмсөгний үйлчилгээний эксперт.",
                specialties: ["Будалт", "Хөмсөг"],
                locations: [riverside._id],
            },
        ]);

        const artists = [naraa, temuujin, khishgee];
        const locations = [central, riverside];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const availabilityDocs = [];

        artists.forEach((artist) => {
            locations
                .filter((location) => Array.isArray(artist.locations) && artist.locations.some((locId) => locId.equals(location._id)))
                .forEach((location) => {
                    for (let index = 0; index < 7; index += 1) {
                        const date = new Date(today);
                        date.setDate(today.getDate() + index);
                        const isoDate = date.toISOString().slice(0, 10);

                        availabilityDocs.push({
                            location: location._id,
                            artist: artist._id,
                            date: isoDate,
                            slots: slotTemplate.map((time) => ({ time })),
                        });
                    }
                });
        });

        if (availabilityDocs.length > 0) {
            await ArtistAvailability.insertMany(availabilityDocs, { ordered: false }).catch(() => undefined);
        }
    })()
        .catch((error) => {
            console.error("Demo data creation failed", error);
        })
        .finally(() => {
            seedingPromise = null;
        });

    return seedingPromise;
};

router.get("/locations", async (req, res) => {
    try {
        await ensureDemoData();
        const locations = await Location.find({ active: true }).sort({ order: 1, name: 1 }).lean();
        return res.json({ success: true, locations: locations.map(toLocationDto) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Салон ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.get("/artists", async (req, res) => {
    const { locationId } = req.query;

    if (!locationId || !isValidObjectId(locationId)) {
        return res.status(400).json({ success: false, error: "Салон сонголт буруу байна." });
    }

    try {
        const artists = await Artist.find({ locations: locationId, active: true }).sort({ name: 1 }).lean();
        return res.json({ success: true, artists: artists.map(toArtistDto) });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Артистын мэдээлэл ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.get("/availability", async (req, res) => {
    const { locationId, artistId } = req.query;
    const daysParam = parseInt(req.query.days, 10) || 7;
    const startDateParam = typeof req.query.fromDate === "string" ? req.query.fromDate : null;

    if (!locationId || !isValidObjectId(locationId)) {
        return res.status(400).json({ success: false, error: "Салон сонголт буруу байна." });
    }

    if (!artistId || !isValidObjectId(artistId)) {
        return res.status(400).json({ success: false, error: "Артист сонголт буруу байна." });
    }

    const days = Math.min(Math.max(daysParam, 1), 30);
    const startDate = startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
        ? new Date(`${startDateParam}T00:00:00`)
        : new Date();
    startDate.setHours(0, 0, 0, 0);

    try {
        const [location, artist] = await Promise.all([
            Location.findById(locationId).lean(),
            Artist.findOne({ _id: artistId, locations: locationId, active: true }).lean(),
        ]);

        if (!location) {
            return res.status(404).json({ success: false, error: "Сонгосон салон олдсонгүй." });
        }

        if (!artist) {
            return res.status(404).json({ success: false, error: "Энэ салонд сонгосон артист олдсонгүй." });
        }

        const targetDates = [];
        for (let index = 0; index < days; index += 1) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + index);
            targetDates.push(date.toISOString().slice(0, 10));
        }

        const availability = await ArtistAvailability.find({
            artist: artistId,
            location: locationId,
            date: { $in: targetDates },
        })
            .lean()
            .then((docs) => docs.map(toAvailabilityDto));

        const mappedByDate = new Map(availability.map((day) => [day.date, day]));

        const resultDays = targetDates.map((dateString) => {
            const entry = mappedByDate.get(dateString) || { date: dateString, slots: [] };
            const weekday = new Date(`${dateString}T00:00:00`).toLocaleDateString("mn-MN", { weekday: "long" });
            return {
                date: dateString,
                weekday,
                slots: entry.slots,
            };
        });

        return res.json({
            success: true,
            location: toLocationDto(location),
            artist: toArtistDto(artist),
            days: resultDays,
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Сул цаг ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.get("/history", requireAuth, async (req, res) => {
    const userId = req.user?.userId;

    if (!userId || !isValidObjectId(userId)) {
        return res.status(401).json({ success: false, error: "Нэвтрэх шаардлагатай." });
    }

    try {
        const bookings = await Booking.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate(["location", "artist"]);

        return res.json({
            success: true,
            bookings: bookings.map((booking) => toBookingDto(booking)),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Захиалгын түүх ачаалахад алдаа гарлаа.", details: err.message });
    }
});

router.post("/", requireAuth, async (req, res) => {
    const { locationId, artistId, date, time, notes } = req.body || {};

    if (!locationId || !isValidObjectId(locationId)) {
        return res.status(400).json({ success: false, error: "Салон сонголт буруу байна." });
    }

    if (!artistId || !isValidObjectId(artistId)) {
        return res.status(400).json({ success: false, error: "Артист сонголт буруу байна." });
    }

    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: "Огноо буруу форматтай байна." });
    }

    if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
        return res.status(400).json({ success: false, error: "Цаг буруу форматтай байна." });
    }

    try {
        const [location, artist] = await Promise.all([
            Location.findById(locationId).lean(),
            Artist.findOne({ _id: artistId, locations: locationId, active: true }).lean(),
        ]);

        if (!location) {
            return res.status(404).json({ success: false, error: "Сонгосон салон олдсонгүй." });
        }

        if (!artist) {
            return res.status(404).json({ success: false, error: "Энэ салонд сонгосон артист олдсонгүй." });
        }

        const availability = await ArtistAvailability.findOneAndUpdate(
            {
                artist: artistId,
                location: locationId,
                date,
                slots: { $elemMatch: { time, isBooked: false } },
            },
            {
                $set: { "slots.$.isBooked": true },
            },
            { new: true },
        );

        if (!availability) {
            return res.status(409).json({ success: false, error: "Энэ цаг аль хэдийн захиалагдсан байна." });
        }

        const bookingData = {
            location: location._id,
            artist: artist._id,
            date,
            time,
            timeslot: `${date}T${time}`,
            status: "confirmed",
            notes: typeof notes === "string" ? notes.trim() || undefined : undefined,
        };

        if (!req.user?.userId || !isValidObjectId(req.user.userId)) {
            return res.status(401).json({ success: false, error: "Нэвтрэх шаардлагатай." });
        }

        bookingData.user = req.user.userId;

        bookingData.customer = {
            phone: req.user?.phone || null,
            name: req.user?.name || null,
        };

        const booking = await Booking.create(bookingData);
        await booking.populate([{ path: "location" }, { path: "artist" }]);

        return res.json({ success: true, booking: toBookingDto(booking) });
    } catch (err) {
        console.error("Booking creation error", err);
        return res.status(500).json({ success: false, error: "Захиалга баталгаажуулахад алдаа гарлаа.", details: err.message });
    }
});

module.exports = router;
