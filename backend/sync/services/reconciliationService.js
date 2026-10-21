/**
 * backend/sync/services/reconciliationService.js
 * Scheduled and on-demand inventory reconciliation engine.
 * Detects inventory discrepancies between Cloudnandy and SkyHMS,
 * reports status, and manages periodic synchronization heartbeats.
 */

const { getSkyHmsAdapter } = require("../adapters/adapterFactory");
const roomMappingService = require("./roomMappingService");
const reservationSyncService = require("./reservationSyncService");
const db = require("../db");
const auditLogger = require("../auditLogger");
const config = require("../config");

const toYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class ReconciliationService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.lastSyncTimestamp = null;
    this.lastSyncStatus = "Not executed yet";
    this.lastSyncStats = {
      reconciledReservations: 0,
      discrepanciesFound: 0,
      errorsCount: 0,
    };
    this.lastAutoSyncTimestamp = null;
    this.lastAutoSyncStatus = "Not executed yet";
    this.lastAutoSyncStats = {
      daysScanned: 0,
      roomsChecked: 0,
      blocksCreated: 0,
      blocksMaintained: 0,
      blocksReleased: 0,
      activeBlocksCount: 0,
      errorsCount: 0,
    };
  }

  /**
   * Start the periodic background reconciliation scheduler.
   */
  startScheduler() {
    if (this.intervalId) clearInterval(this.intervalId);

    const intervalMs = Math.max(1, config.syncIntervalMinutes) * 60 * 1000;
    auditLogger.info(
      "SCHEDULER_STARTED",
      `Scheduled inventory reconciliation job active (every ${config.syncIntervalMinutes} minutes).`
    );

    // Initial delayed run after 15 seconds to let server finish bootstrapping
    setTimeout(() => {
      this.runReconciliation().catch((err) => {
        auditLogger.error("SCHEDULER_INIT_RUN_ERROR", err.message);
      });
    }, 15000);

    this.intervalId = setInterval(() => {
      this.runReconciliation().catch((err) => {
        auditLogger.error("SCHEDULER_CRON_ERROR", err.message);
      });
    }, intervalMs);
  }

  /**
   * Stop background scheduler.
   */
  stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      auditLogger.info("SCHEDULER_STOPPED", "Reconciliation scheduler stopped.");
    }
  }

  /**
   * Run comprehensive reconciliation job (manual trigger or scheduled).
   *
   * @param {Object} [options]
   * @param {boolean} [options.isDryRun=false] - Preview mode without writing changes
   * @returns {Promise<{ ok: boolean, timestamp: string, stats: any, discrepancies: Array<any> }>}
   */
  async runReconciliation(options = {}) {
    if (this.isRunning) {
      auditLogger.warn("RECONCILIATION_BUSY", "A reconciliation job is already running. Skipping concurrent run.");
      return { ok: false, message: "Reconciliation currently running" };
    }

    this.isRunning = true;
    const isDryRun = options.isDryRun !== undefined ? options.isDryRun : config.dryRunMode;
    const discrepancies = [];
    const stats = {
      checkedRoomTypes: 0,
      verifiedMappings: 0,
      reconciledReservations: 0,
      discrepanciesFound: 0,
      errorsCount: 0,
      isDryRun,
    };

    auditLogger.info(
      "RECONCILIATION_START",
      `Starting ${isDryRun ? "[DRY-RUN] " : ""}inventory reconciliation cycle.`
    );

    try {
      const adapter = getSkyHmsAdapter();

      // 1. Verify SkyHMS connectivity
      const conn = await adapter.testConnection();
      if (!conn.ok) {
        throw new Error(`SkyHMS unreachable: ${conn.message}`);
      }

      // 2. Room Mappings Check
      const mappings = await roomMappingService.getAllMappings();
      stats.verifiedMappings = mappings.filter((m) => m.is_active).length;

      // 3. Date Horizon: Today to +90 days
      const today = new Date();
      const horizonDate = new Date();
      horizonDate.setDate(today.getDate() + config.reconciliationDaysAhead);

      const startDateStr = toYMD(today);
      const endDateStr = toYMD(horizonDate);

      // 4. Fetch SkyHMS inventory
      const externalInventory = await adapter.getInventory(startDateStr, endDateStr);
      stats.checkedRoomTypes = mappings.length;

      // 5. Compare with local bookings
      const localConfirmedBookings = await db.getConfirmedBookings();
      const reservationMappings = await db.getAllReservationMappings(200);

      // Check for discrepancies: any confirmed local booking missing in SkyHMS mapping
      for (const localBooking of localConfirmedBookings) {
        if (localBooking.origin === "SKYHMS" || (localBooking.order_id && (localBooking.order_id.startsWith("SKYHMS-") || localBooking.order_id.startsWith("SKY-")))) continue; // already comes from SkyHMS

        const foundMapping = reservationMappings.find(
          (m) => m.internal_order_id === localBooking.order_id
        );

        if (!foundMapping || foundMapping.sync_status !== "synced") {
          discrepancies.push({
            type: "UNSYNCED_LOCAL_BOOKING",
            severity: "high",
            orderId: localBooking.order_id,
            room: localBooking.room,
            dates: `${localBooking.check_in} -> ${localBooking.check_out}`,
            message: `Booking ${localBooking.order_id} exists in Cloudnandy but is not confirmed in SkyHMS.`,
          });
        }
      }

      stats.discrepanciesFound = discrepancies.length;
      stats.reconciledReservations = reservationMappings.filter((m) => m.sync_status === "synced").length;

      // Auto-retry pending jobs if any
      if (!isDryRun) {
        await reservationSyncService.retryFailedJobs();
      }

      // Automatically cancel abandoned pending bookings (> 30 minutes old) to keep inventory clean
      if (!isDryRun && db.supabase) {
        try {
          const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          await db.supabase
            .from("bookings")
            .update({ status: "cancelled", payment_tracking_id: "EXPIRED_ABANDONED" })
            .eq("status", "pending")
            .lt("booked_at", thirtyMinsAgo);
        } catch (cleanupErr) {
          // Non-blocking cleanup
        }
      }

      // Synchronize live room prices and names from SkyHMS to website
      let rateSyncSummary = null;
      if (!isDryRun) {
        try {
          rateSyncSummary = await this.syncLiveRatesAndRooms();
        } catch (rateErr) {
          auditLogger.warn("RATE_SYNC_CYCLE_WARN", `Live rate sync warning: ${rateErr.message}`);
        }
      }

      // Run automated SkyRooms inventory sweep if autoSync is enabled
      let autoSyncSummary = null;
      if (config.autoSyncEnabled) {
        try {
          autoSyncSummary = await this.autoSyncSkyRoomsInventory({
            daysAhead: config.autoSyncDaysAhead || 30,
            isDryRun,
          });
        } catch (autoErr) {
          auditLogger.warn("AUTO_SYNC_CYCLE_WARN", `Automated inventory sweep warning: ${autoErr.message}`);
        }
      }

      this.lastSyncTimestamp = new Date().toISOString();
      this.lastSyncStatus = discrepancies.length > 0 ? "Completed with Discrepancies" : "Healthy";
      this.lastSyncStats = stats;

      auditLogger.info(
        "RECONCILIATION_FINISH",
        `Reconciliation finished. ${discrepancies.length} discrepancy(ies) detected. Status: ${this.lastSyncStatus}.`,
        { stats, discrepanciesSummary: discrepancies.length, autoSync: autoSyncSummary ? autoSyncSummary.stats : null, ratesSynced: rateSyncSummary ? rateSyncSummary.updatedRooms.length : 0 }
      );

      return {
        ok: true,
        timestamp: this.lastSyncTimestamp,
        status: this.lastSyncStatus,
        stats,
        discrepancies,
        autoSync: autoSyncSummary,
      };
    } catch (err) {
      stats.errorsCount++;
      this.lastSyncStatus = `Error: ${err.message}`;
      auditLogger.error("RECONCILIATION_ERROR", `Reconciliation cycle failed: ${err.message}`, {
        error: err.message,
      });

      return {
        ok: false,
        error: err.message,
        timestamp: new Date().toISOString(),
        stats,
        discrepancies,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Automated SkyRooms inventory sweep:
   * Sweeps next N days (default 30 days) from SkyRooms booking link:
   * https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1
   *
   * Detects booked/blocked dates for each of the 5 rooms and automatically
   * creates/maintains blocks in Cloudnandy's bookings table.
   * If a room opens back up on SkyRooms, the block is automatically cancelled.
   */
  async autoSyncSkyRoomsInventory(options = {}) {
    const daysAhead = options.daysAhead || config.autoSyncDaysAhead || 30;
    const isDryRun = options.isDryRun !== undefined ? options.isDryRun : config.dryRunMode;

    auditLogger.info(
      "AUTO_SYNC_START",
      `Starting automated SkyRooms inventory sweep (${daysAhead} days ahead)${isDryRun ? " [DRY-RUN]" : ""}...`
    );

    const adapter = getSkyHmsAdapter();
    const mappings = await roomMappingService.getAllMappings();
    const activeMappings = mappings.filter((m) => m.is_active);

    const stats = {
      daysScanned: 0,
      roomsChecked: 0,
      blocksCreated: 0,
      blocksMaintained: 0,
      blocksReleased: 0,
      activeBlocksCount: 0,
      errorsCount: 0,
    };

    const details = [];
    const today = new Date();

    try {
      for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
        const checkInDate = new Date(today);
        checkInDate.setDate(today.getDate() + dayOffset);

        const checkOutDate = new Date(today);
        checkOutDate.setDate(today.getDate() + dayOffset + 1);

        const checkIn = toYMD(checkInDate);
        const checkOut = toYMD(checkOutDate);

        stats.daysScanned++;

        // Query all rooms availability for this single day span
        let roomAvailabilities = [];
        try {
          roomAvailabilities = await adapter.checkAllRoomsAvailability(checkIn, checkOut);
        } catch (dayErr) {
          stats.errorsCount++;
          auditLogger.warn("AUTO_SYNC_DAY_ERR", `Failed checking availability for ${checkIn}: ${dayErr.message}`);
          continue;
        }

        for (const roomResult of roomAvailabilities) {
          stats.roomsChecked++;
          const mapping = activeMappings.find(
            (m) =>
              (m.skyhms_room_type_id || "").toUpperCase() === (roomResult.roomTypeId || "").toUpperCase()
          );

          if (!mapping) continue;

          const isUnavailable = !roomResult.available || roomResult.availableUnits === 0;

          if (isUnavailable) {
            // Room is blocked or booked on SkyRooms
            if (!isDryRun) {
              const res = await db.upsertSkyHmsAutoBlock({
                roomName: mapping.property_name,
                roomCode: roomResult.roomTypeId,
                checkIn,
                checkOut,
              });

              if (res.action === "created") {
                stats.blocksCreated++;
                details.push({ action: "blocked", room: mapping.property_name, code: roomResult.roomTypeId, checkIn });
              } else {
                stats.blocksMaintained++;
              }
            } else {
              stats.blocksCreated++;
              details.push({ action: "dry-run-block", room: mapping.property_name, code: roomResult.roomTypeId, checkIn });
            }
          } else {
            // Room is available on SkyRooms. Check if we need to release any prior block.
            if (!isDryRun) {
              const releaseRes = await db.releaseSkyHmsAutoBlock({
                roomCode: roomResult.roomTypeId,
                checkIn,
              });
              if (releaseRes.released) {
                stats.blocksReleased++;
                details.push({ action: "released", room: mapping.property_name, code: roomResult.roomTypeId, checkIn });
              }
            }
          }
        }

        // Small pause (75ms) between date iterations if adapter is live web
        if (!adapter.isMock && dayOffset < daysAhead - 1) {
          await new Promise((r) => setTimeout(r, 75));
        }
      }

      // Count total active auto-blocks now
      const currentBlocks = await db.getSkyHmsAutoBlocks();
      stats.activeBlocksCount = currentBlocks.length;

      this.lastAutoSyncTimestamp = new Date().toISOString();
      this.lastAutoSyncStatus = "Healthy";
      this.lastAutoSyncStats = stats;

      auditLogger.info(
        "AUTO_SYNC_COMPLETED",
        `Automated SkyRooms sweep finished: ${stats.daysScanned} days scanned, ${stats.blocksCreated} new blocks, ${stats.blocksReleased} released, ${stats.activeBlocksCount} active total.`,
        { stats, sampleChanges: details.slice(0, 10) }
      );

      return {
        ok: true,
        timestamp: this.lastAutoSyncTimestamp,
        status: this.lastAutoSyncStatus,
        stats,
        details,
      };
    } catch (error) {
      stats.errorsCount++;
      this.lastAutoSyncStatus = `Error: ${error.message}`;
      auditLogger.error("AUTO_SYNC_ERROR", `Auto-sync sweep failed: ${error.message}`, { error: error.message });
      return {
        ok: false,
        timestamp: new Date().toISOString(),
        status: this.lastAutoSyncStatus,
        stats,
        error: error.message,
      };
    }
  }

  /**
   * Synchronize room prices and details from SkyHMS into Cloudnandy website.
   * Matches rooms by SkyHMS room type code (MCB, DMV, SFV, DTWH, DDM),
   * and updates the Supabase 'properties' table so the website price and room title
   * match SkyHMS in real-time.
   */
  async syncLiveRatesAndRooms() {
    const adapter = getSkyHmsAdapter();
    const liveRooms = await adapter.getRoomTypes();
    const mappings = await roomMappingService.getAllMappings();
    const updatedRooms = [];

    for (const liveRoom of liveRooms) {
      const mapping = mappings.find(
        (m) => (m.skyhms_room_type_id || "").toUpperCase() === (liveRoom.roomTypeId || "").toUpperCase()
      );

      if (!mapping || !mapping.property_id) continue;

      const newPrice = Math.round(Number(liveRoom.rate || 0));
      if (newPrice > 0) {
        // Update Supabase properties table so website displays exact SkyHMS price & title
        await db.updatePropertyPriceAndDetails(mapping.property_id, {
          price: newPrice,
          name: liveRoom.roomTypeName || mapping.property_name,
          guests_allowed: String(liveRoom.maxCapacity || liveRoom.baseCapacity || 2),
        });

        // Update mapping record
        await db.saveRoomMapping({
          ...mapping,
          property_name: liveRoom.roomTypeName || mapping.property_name,
          skyhms_room_type_name: liveRoom.roomTypeName,
          last_verified_at: new Date().toISOString(),
        });

        updatedRooms.push({
          code: liveRoom.roomTypeId,
          name: liveRoom.roomTypeName,
          price: newPrice,
          capacity: liveRoom.maxCapacity || liveRoom.baseCapacity,
          propertyId: mapping.property_id,
        });
      }
    }

    auditLogger.info("RATES_SYNCED", `Synchronized ${updatedRooms.length} room rates and names from SkyHMS to website.`, {
      updatedRooms,
    });

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      updatedRooms,
    };
  }

  /**
   * Get operational health status for admin dashboard.
   */
  async getStatus() {
    const adapter = getSkyHmsAdapter();
    const mappings = await roomMappingService.getAllMappings();
    const resMappings = await db.getAllReservationMappings(100);
    const autoBlocks = await db.getSkyHmsAutoBlocks();

    const counts = {
      totalMappings: mappings.length,
      activeMappings: mappings.filter((m) => m.is_active).length,
      syncedBookings: resMappings.filter((r) => r.sync_status === "synced").length,
      pendingSync: resMappings.filter((r) => r.sync_status === "pending").length,
      failedSync: resMappings.filter((r) => r.sync_status === "failed").length,
      activeAutoBlocks: autoBlocks.length,
    };

    return {
      syncEnabled: config.syncEnabled,
      dryRunMode: config.dryRunMode,
      adapterMode: adapter.isMock ? "Mock / Sandbox" : "Live SkyHMS API",
      apiBaseUrl: adapter.isMock ? "internal://mock-skyhms" : config.apiBaseUrl,
      hotelCode: config.hotelCode,
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastSyncStatus: this.lastSyncStatus,
      lastSyncStats: this.lastSyncStats,
      syncIntervalMinutes: config.syncIntervalMinutes,
      autoSync: {
        enabled: config.autoSyncEnabled,
        daysAhead: config.autoSyncDaysAhead,
        lastTimestamp: this.lastAutoSyncTimestamp,
        lastStatus: this.lastAutoSyncStatus,
        lastStats: this.lastAutoSyncStats,
      },
      counts,
    };
  }
}

module.exports = new ReconciliationService();
