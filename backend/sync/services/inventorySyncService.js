/**
 * backend/sync/services/inventorySyncService.js
 * Unified inventory availability calculation across Cloudnandy and SkyHMS.
 * Enforces strict non-overselling constraints for every night of a guest stay.
 */

const db = require("../db");
const roomMappingService = require("./roomMappingService");
const { getSkyHmsAdapter } = require("../adapters/adapterFactory");
const auditLogger = require("../auditLogger");
const config = require("../config");

class InventorySyncService {
  /**
   * Helper: Check if two date ranges overlap.
   * Standard hotel stay rule: [A_in, A_out) overlaps with [B_in, B_out)
   * iff A_in < B_out AND A_out > B_in.
   */
  hasDateOverlap(inA, outA, inB, outB) {
    const sA = new Date(inA + "T00:00:00");
    const eA = new Date(outA + "T00:00:00");
    const sB = new Date(inB + "T00:00:00");
    const eB = new Date(outB + "T00:00:00");
    return sA < eB && eA > sB;
  }

  normalizeRoomKey(name) {
    if (!name) return "";
    const s = String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (s.includes("deluxe") || s.includes("dlx") || s.includes("dmv")) return "dmv";
    if (s.includes("wooden") || s.includes("twobed") || s.includes("doublebed") || s.includes("dtwh")) return "dtwh";
    if (s.includes("superior") || s.includes("afram") || s.includes("sfv")) return "sfv";
    if (s.includes("premium") || s.includes("family") || s.includes("ddm")) return "ddm";
    if (s.includes("mountain") || s.includes("mcb") || s.includes("cabin")) return "mcb";
    return s;
  }

  areRoomsMatching(nameA, nameB) {
    if (!nameA || !nameB) return false;
    const a = String(nameA).trim().toLowerCase();
    const b = String(nameB).trim().toLowerCase();
    if (a === b) return true;
    const kA = this.normalizeRoomKey(a);
    const kB = this.normalizeRoomKey(b);
    return kA && kB && kA === kB;
  }

  /**
   * Calculate local booked units for a specific room across requested dates.
   * Checks both Cloudnandy bookings and synced SkyHMS reservation records.
   */
  async getLocalBookedUnits(roomName, checkIn, checkOut) {
    const confirmedBookings = await db.getConfirmedBookings();

    const overlappingBookings = confirmedBookings.filter((b) => {
      if (!this.areRoomsMatching(b.room, roomName)) return false;
      return this.hasDateOverlap(checkIn, checkOut, b.check_in, b.check_out);
    });

    return overlappingBookings.length;
  }

  /**
   * Authoritative Availability Check:
   * Validates availability across BOTH local reservation ledger AND SkyHMS PMS.
   *
   * @param {Object} params
   * @param {string} params.roomName - Property/Room name
   * @param {string} params.checkIn - ISO Date YYYY-MM-DD
   * @param {string} params.checkOut - ISO Date YYYY-MM-DD
   * @param {number} [params.requestedRooms=1] - Requested quantity
   * @returns {Promise<{ isAvailable: boolean, availableUnits: number, totalInventory: number, localBookedUnits: number, externalAvailableUnits: number, reason?: string }>}
   */
  async checkAvailability({ roomName, checkIn, checkOut, requestedRooms = 1 }) {
    if (!roomName || !checkIn || !checkOut) {
      throw new Error("Missing parameters for availability check: roomName, checkIn, checkOut are required.");
    }

    const s = new Date(checkIn + "T00:00:00");
    const e = new Date(checkOut + "T00:00:00");
    if (isNaN(s) || isNaN(e) || e <= s) {
      return {
        isAvailable: false,
        availableUnits: 0,
        totalInventory: 0,
        reason: "Check-out date must be strictly after check-in date.",
      };
    }

    // 1. Resolve room mapping to find total inventory and SkyHMS room type
    const mapping = await roomMappingService.resolveInternalToExternal(roomName);
    const totalInventory = mapping ? mapping.total_inventory : 1;

    // 2. Local ledger check
    const localBookedUnits = await this.getLocalBookedUnits(roomName, checkIn, checkOut);
    const localAvailableUnits = Math.max(0, totalInventory - localBookedUnits);

    if (localAvailableUnits < requestedRooms) {
      return {
        isAvailable: false,
        availableUnits: localAvailableUnits,
        totalInventory,
        localBookedUnits,
        externalAvailableUnits: null,
        reason: `Room is already reserved for the requested dates in the Cloudnandy ledger (${localBookedUnits}/${totalInventory} booked).`,
      };
    }

    // 3. SkyHMS check (if mapping exists and sync is enabled)
    let externalAvailableUnits = localAvailableUnits;

    if (config.syncEnabled && mapping && mapping.skyhms_room_type_id) {
      try {
        const adapter = getSkyHmsAdapter();
        const skyAvail = await adapter.checkAvailability(
          mapping.skyhms_room_type_id,
          checkIn,
          checkOut,
          requestedRooms
        );

        externalAvailableUnits = skyAvail.availableUnits;

        if (!skyAvail.available || skyAvail.availableUnits < requestedRooms) {
          auditLogger.info(
            "EXT_AVAILABILITY_BLOCKED",
            `SkyHMS reported zero or insufficient availability for '${mapping.skyhms_room_type_id}' on ${checkIn} to ${checkOut}.`,
            { requestedRooms, skyAvail }
          );
          return {
            isAvailable: false,
            availableUnits: 0,
            totalInventory,
            localBookedUnits,
            externalAvailableUnits: skyAvail.availableUnits,
            reason: `Dates are blocked or booked in SkyHMS Property Management System.`,
          };
        }
      } catch (err) {
        auditLogger.warn(
          "SKYHMS_AVAIL_QUERY_WARN",
          `Could not verify availability with SkyHMS: ${err.message}. Relying on local reservation ledger.`,
          { error: err.message }
        );
        // Fail-safe: if SkyHMS is temporarily unreachable, allow booking only if local ledger has verified capacity
      }
    }

    const effectiveAvailableUnits = Math.min(localAvailableUnits, externalAvailableUnits);

    return {
      isAvailable: effectiveAvailableUnits >= requestedRooms,
      availableUnits: effectiveAvailableUnits,
      totalInventory,
      localBookedUnits,
      externalAvailableUnits,
    };
  }

  /**
   * Block room inventory locally when a booking starts or when received from SkyHMS.
   */
  async lockInventoryForHold({ roomName, checkIn, checkOut, orderId }) {
    const avail = await this.checkAvailability({ roomName, checkIn, checkOut, requestedRooms: 1 });
    if (!avail.isAvailable) {
      throw new Error(avail.reason || "Room unavailable for the selected dates.");
    }
    return { ok: true, availableUnits: avail.availableUnits - 1 };
  }
}

module.exports = new InventorySyncService();
