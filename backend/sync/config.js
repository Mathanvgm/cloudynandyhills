/**
 * backend/sync/config.js
 * Central configuration for SkyHMS integration.
 * All settings are loaded from environment variables with safe defaults.
 */

const parseBool = (val, defaultVal = false) => {
  if (val === undefined || val === null || val === "") return defaultVal;
  return String(val).toLowerCase() === "true" || String(val) === "1";
};

const parseIntSafe = (val, defaultVal = 0) => {
  const n = parseInt(val, 10);
  return isNaN(n) ? defaultVal : n;
};

const config = {
  // Sync Engine Global Controls
  syncEnabled: parseBool(process.env.SKYHMS_SYNC_ENABLED, true),
  dryRunMode: parseBool(process.env.SKYHMS_DRY_RUN, false),
  
  // Use mock adapter if in test environment or explicitly set to true
  useMock: process.env.NODE_ENV === "test" || parseBool(process.env.SKYHMS_USE_MOCK, false),

  // SkyHMS Connection Settings
  apiBaseUrl: process.env.SKYHMS_API_URL || "https://bookings.skyrooms.in",
  apiKey: process.env.SKYHMS_API_KEY || "",
  hotelCode: process.env.SKYHMS_HOTEL_CODE || "1035",
  propertyId: process.env.SKYHMS_PROPERTY_ID || "1035",
  bookingUrl: "https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1",
  apiTimeoutMs: parseIntSafe(process.env.SKYHMS_TIMEOUT_MS, 15000),

  // Webhook Authentication
  webhookSecret: process.env.SKYHMS_WEBHOOK_SECRET || "cnh-skyhms-webhook-secret-change-in-prod",
  
  // Polling & Scheduler
  syncIntervalMinutes: parseIntSafe(process.env.SKYHMS_SYNC_INTERVAL_MINUTES, 15),
  reconciliationDaysAhead: parseIntSafe(process.env.SKYHMS_RECONCILIATION_DAYS, 90),
  autoSyncEnabled: parseBool(process.env.SKYHMS_AUTO_SYNC_ENABLED, true),
  autoSyncDaysAhead: parseIntSafe(process.env.SKYHMS_AUTO_SYNC_DAYS_AHEAD, 30),
  
  // Concurrency & Retries
  maxRetries: parseIntSafe(process.env.SKYHMS_MAX_RETRIES, 5),
  initialRetryDelayMs: parseIntSafe(process.env.SKYHMS_RETRY_DELAY_MS, 2000),
  maxRetryDelayMs: parseIntSafe(process.env.SKYHMS_MAX_RETRY_DELAY_MS, 60000),

  // Hotel details
  propertyDetails: {
    name: "Cloudnandy Resort",
    location: "Poombarai, Kodaikanal, Tamil Nadu, India",
    pincode: "624103",
    timezone: "Asia/Kolkata",
    checkInTime: "13:00",
    checkOutTime: "11:00",
  },
};

module.exports = config;
