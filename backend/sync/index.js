/**
 * backend/sync/index.js
 * Entry point for Cloudnandy SkyHMS Inventory Synchronization Subsystem.
 */

const config = require("./config");
const db = require("./db");
const auditLogger = require("./auditLogger");
const syncRoutes = require("./routes/syncRoutes");
const inventorySyncService = require("./services/inventorySyncService");
const reservationSyncService = require("./services/reservationSyncService");
const roomMappingService = require("./services/roomMappingService");
const reconciliationService = require("./services/reconciliationService");
const { getSkyHmsAdapter, getMockAdapter } = require("./adapters/adapterFactory");

function initSkyHmsSync(app, supabaseClient) {
  auditLogger.info("INIT", "Initializing SkyHMS Inventory Synchronization Engine...");

  if (supabaseClient) {
    db.setClient(supabaseClient);
    auditLogger.info("INIT", "Connected Supabase client to sync database layer.");
  }

  // Mount sync API routes
  if (app) {
    app.use("/api/skyhms", syncRoutes);
    auditLogger.info("INIT", "Mounted SkyHMS endpoints at /api/skyhms/*");
  }

  // Start background reconciliation scheduler if sync is enabled
  if (config.syncEnabled) {
    reconciliationService.startScheduler();
  }

  return {
    config,
    inventorySyncService,
    reservationSyncService,
    roomMappingService,
    reconciliationService,
    auditLogger,
    getSkyHmsAdapter,
    getMockAdapter,
  };
}

module.exports = {
  initSkyHmsSync,
  config,
  inventorySyncService,
  reservationSyncService,
  roomMappingService,
  reconciliationService,
  auditLogger,
  getSkyHmsAdapter,
  getMockAdapter,
};
