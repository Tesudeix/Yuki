const twilio = require('twilio');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials are not configured.');
}

if (!TWILIO_VERIFY_SERVICE_SID) {
    throw new Error('Twilio Verify service SID is not configured.');
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const CACHE_TTL_SUCCESS_MS = 1000 * 60 * 5; // 5 minutes
const CACHE_TTL_ERROR_MS = 1000 * 30; // 30 seconds

let cachedStatus = null;

const toServiceSummary = (service) => ({
    sid: service.sid,
    friendlyName: service.friendlyName,
    codeLength: service.codeLength,
    customCodeEnabled: service.customCodeEnabled,
});

const serializeError = (error) => ({
    message: error instanceof Error ? error.message : 'Unknown Twilio error',
    code: typeof error?.code === 'number' ? error.code : undefined,
});

const checkVerifyService = async ({ force = false } = {}) => {
    const now = Date.now();

    if (!force && cachedStatus) {
        const ttl = cachedStatus.ok ? CACHE_TTL_SUCCESS_MS : CACHE_TTL_ERROR_MS;
        if (now - cachedStatus.timestamp < ttl) {
            return cachedStatus;
        }
    }

    try {
        const service = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID).fetch();
        cachedStatus = {
            ok: true,
            service: toServiceSummary(service),
            timestamp: now,
        };
    } catch (error) {
        cachedStatus = {
            ok: false,
            error: serializeError(error),
            timestamp: now,
        };
    }

    return cachedStatus;
};

module.exports = {
    client,
    verifyServiceSid: TWILIO_VERIFY_SERVICE_SID,
    checkVerifyService,
};
