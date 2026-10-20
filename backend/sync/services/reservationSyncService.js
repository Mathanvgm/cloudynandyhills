/**
 * backend/sync/services/reservationSyncService.js
 * Bi-directional reservation synchronization between Cloudnandy custom booking engine
 * and SkyHMS. Implements strict idempotency, loop prevention, and event deduplication.
 */

const db = require("../db");
const roomMappingService = require("./roomMappingService");
const { getSkyHmsAdapter } = require("../adapters/adapterFactory");
const auditLogger = require("../auditLogger");
const config = require("../config");

class ReservationSyncService {
  /**
   * OUTBOUND: Sync a Cloudnandy website booking to SkyHMS.
   * Called when a customer reserves or pays on the Cloudnandy site.
   *
   * @param {Object} booking - Booking row from Cloudnandy
   * @returns {Promise<{ ok: boolean, status: string, externalReservationId?: string, error?: string }>}
   */
  async syncWebsiteBookingToSkyHms(booking) {
    if (!config.syncEnabled) {
      auditLogger.info("SYNC_DISABLED_SKIPPED", `Skipping SkyHMS sync for ${booking.order_id} (sync is disabled).`);
      return { ok: true, status: "disabled" };
    }

    // 1. Loop Prevention: never sync back reservations that originated from SkyHMS
    if (booking.origin === "SKYHMS") {
      auditLogger.info("LOOP_PREVENTED", `Skipping outbound sync for reservation ${booking.order_id} (origin is SKYHMS).`);
      return { ok: true, status: "loop_prevented" };
    }

    // 2. Check if already synced in mapping table
    const existingMapping = await db.getReservationMappingByOrderId(booking.order_id);
    if (existingMapping && existingMapping.sync_status === "synced" && existingMapping.skyhms_reservation_id) {
      auditLogger.info("ALREADY_SYNCED", `Booking ${booking.order_id} is already mapped to ${existingMapping.skyhms_reservation_id}.`);
      return {
        ok: true,
        status: "already_synced",
        externalReservationId: existingMapping.skyhms_reservation_id,
        confirmationNo: existingMapping.skyhms_confirmation_no,
      };
    }

    // 3. Resolve room mapping
    const mapping = await roomMappingService.resolveInternalToExternal(booking.room);
    if (!mapping) {
      const err = `Cannot sync booking ${booking.order_id}: Room '${booking.room}' has no active SkyHMS room mapping.`;
      auditLogger.error("SYNC_UNMAPPED_ROOM", err, { orderId: booking.order_id, room: booking.room });

      await db.upsertReservationMapping({
        internal_order_id: booking.order_id,
        room_name: booking.room,
        check_in: booking.check_in,
        check_out: booking.check_out,
        origin: "CUSTOM_ENGINE",
        sync_status: "failed",
        last_error: err,
      });

      return { ok: false, status: "unmapped_room", error: err };
    }

    // Dry-run mode check
    if (config.dryRunMode) {
      auditLogger.info("DRY_RUN_SYNC", `[DRY-RUN] Would have created SkyHMS reservation for ${booking.order_id}.`, {
        room: booking.room,
        skyHmsRoomType: mapping.skyhms_room_type_id,
      });
      return { ok: true, status: "dry_run", externalReservationId: "DRY-RUN-RES-000" };
    }

    // 4. Dispatch to SkyHMS adapter
    try {
      const adapter = getSkyHmsAdapter();
      const res = await adapter.createReservation({
        reservationId: booking.order_id, // Idempotency key
        roomTypeId: mapping.skyhms_room_type_id,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        numberOfRooms: 1,
        guestName: booking.name,
        guestEmail: booking.email || "",
        guestPhone: booking.phone || "",
        adults: Number(booking.adults || 1),
        children: Number(booking.children || 0),
        totalAmount: Number(booking.total_amount || 0),
        ratePlanId: mapping.rate_plan_id || "STANDARD",
        remarks: booking.requests || "Direct booking via cloudnandyhills.com",
      });

      // Record successful mapping
      await db.upsertReservationMapping({
        internal_booking_id: booking.id,
        internal_order_id: booking.order_id,
        skyhms_reservation_id: res.externalReservationId,
        skyhms_confirmation_no: res.confirmationNo,
        room_name: booking.room,
        skyhms_room_type_id: mapping.skyhms_room_type_id,
        check_in: booking.check_in,
        check_out: booking.check_out,
        origin: "CUSTOM_ENGINE",
        sync_status: "synced",
        payload: res,
      });

      auditLogger.info(
        "BOOKING_SYNCED_TO_SKYHMS",
        `Successfully pushed booking ${booking.order_id} to SkyHMS (External ID: ${res.externalReservationId}).`
      );

      return {
        ok: true,
        status: "synced",
        externalReservationId: res.externalReservationId,
        confirmationNo: res.confirmationNo,
      };
    } catch (err) {
      // Graceful error recovery: do not crash customer flow, mark pending retry
      auditLogger.error("SKYHMS_SYNC_ERROR", `Failed to push booking ${booking.order_id} to SkyHMS: ${err.message}`, {
        error: err.message,
        orderId: booking.order_id,
      });

      const currentRetries = existingMapping ? (existingMapping.retry_count || 0) + 1 : 1;

      await db.upsertReservationMapping({
        internal_booking_id: booking.id,
        internal_order_id: booking.order_id,
        room_name: booking.room,
        skyhms_room_type_id: mapping.skyhms_room_type_id,
        check_in: booking.check_in,
        check_out: booking.check_out,
        origin: "CUSTOM_ENGINE",
        sync_status: "pending",
        retry_count: currentRetries,
        last_error: err.message,
      });

      return { ok: false, status: "pending_retry", error: err.message };
    }
  }

  /**
   * INBOUND: Handle reservation webhook / event arriving from SkyHMS or Channel Manager.
   *
   * @param {Object} eventData
   * @param {string} eventData.eventId - Unique event ID for deduplication
   * @param {string} eventData.eventType - 'reservation_created', 'reservation_cancelled', etc.
   * @param {Object} eventData.payload - SkyHMS reservation payload
   * @returns {Promise<{ ok: boolean, action: string, message: string }>}
   */
  async handleInboundReservationEvent(eventData) {
    const { eventId, eventType, payload } = eventData;

    if (!eventId) {
      throw new Error("Missing required eventId in SkyHMS webhook payload.");
    }

    // 1. Deduplication: Check if this event ID was already processed
    const alreadyProcessed = await db.isEventProcessed(eventId);
    if (alreadyProcessed) {
      auditLogger.info("DUPLICATE_EVENT_IGNORED", `Event ${eventId} has already been processed. Ignoring.`, { eventId });
      return { ok: true, action: "ignored_duplicate", message: "Event already processed." };
    }

    const externalReservationId =
      payload.externalReservationId || payload.reservationId || payload.id;
    const roomTypeId = payload.roomTypeId || payload.room_type_id;

    // 2. Loop Prevention: Check if this reservation originally came from our engine
    const existingMapping = await db.getReservationMappingBySkyHmsId(externalReservationId);
    if (existingMapping && existingMapping.origin === "CUSTOM_ENGINE") {
      auditLogger.info("LOOP_PREVENTED_INBOUND", `Inbound event ${eventId} reflects our own booking ${existingMapping.internal_order_id}. Skipping loop.`);
      await db.recordSyncEvent(eventId, eventType, payload, "processed");
      return { ok: true, action: "loop_prevented", message: "Own booking loop avoided." };
    }

    // 3. Handle by event type
    try {
      if (eventType === "reservation_cancelled" || payload.status === "CANCELLED") {
        await this._handleInboundCancellation(externalReservationId, payload);
      } else if (eventType === "reservation_modified") {
        await this._handleInboundModification(externalReservationId, roomTypeId, payload);
      } else {
        // Default: reservation_created or confirmed
        await this._handleInboundCreation(externalReservationId, roomTypeId, payload);
      }

      await db.recordSyncEvent(eventId, eventType, payload, "processed");
      return { ok: true, action: "processed", message: `Event ${eventId} successfully applied.` };
    } catch (err) {
      await db.recordSyncEvent(eventId, eventType, payload, "failed", err.message);
      auditLogger.error("INBOUND_EVENT_FAIL", `Failed to apply SkyHMS event ${eventId}: ${err.message}`, {
        eventId,
        error: err.message,
      });
      throw err;
    }
  }

  async _handleInboundCreation(externalReservationId, roomTypeId, payload) {
    // Resolve room type mapping
    const mapping = await roomMappingService.resolveExternalToInternal(roomTypeId);
    if (!mapping) {
      throw new Error(`Cannot import SkyHMS reservation ${externalReservationId}: Unmapped room type '${roomTypeId}'. Quarantined.`);
    }

    // Insert into local bookings ledger with origin = 'SKYHMS'
    const checkIn = payload.checkIn || payload.check_in;
    const checkOut = payload.checkOut || payload.check_out;

    const guest = payload.guest || {};
    const guestName = guest.name || payload.guestName || "SkyHMS Guest";
    const guestEmail = guest.email || payload.guestEmail;
    const guestPhone = guest.phone || payload.guestPhone || "0000000000";

    const inserted = await db.insertBookingFromSkyHms({
      externalReservationId,
      roomName: mapping.property_name,
      checkIn,
      checkOut,
      guestName,
      guestEmail,
      guestPhone,
      adults: payload.adults || 2,
      children: payload.children || 0,
      totalAmount: payload.totalAmount || 0,
      remarks: payload.remarks || payload.source || "SkyHMS PMS Sync",
    });

    // Record reservation mapping
    await db.upsertReservationMapping({
      internal_booking_id: inserted.id,
      internal_order_id: inserted.order_id,
      skyhms_reservation_id: externalReservationId,
      skyhms_confirmation_no: payload.confirmationNo || payload.confirmation_number,
      room_name: mapping.property_name,
      skyhms_room_type_id: roomTypeId,
      check_in: checkIn,
      check_out: checkOut,
      origin: "SKYHMS",
      sync_status: "synced",
      payload,
    });

    auditLogger.info(
      "SKYHMS_BOOKING_INGESTED",
      `Ingested SkyHMS reservation ${externalReservationId} for '${mapping.property_name}' (${checkIn} to ${checkOut}). Local order: ${inserted.order_id}.`
    );
  }

  async _handleInboundCancellation(externalReservationId, payload) {
    await db.cancelBookingBySkyHmsId(externalReservationId);

    const mapping = await db.getReservationMappingBySkyHmsId(externalReservationId);
    if (mapping) {
      mapping.sync_status = "cancelled";
      await db.upsertReservationMapping(mapping);
    }

    auditLogger.info(
      "SKYHMS_CANCELLATION_APPLIED",
      `Cancelled local booking for SkyHMS reservation ${externalReservationId}. Inventory restored.`
    );
  }

  async _handleInboundModification(externalReservationId, roomTypeId, payload) {
    // If reservation exists locally, update dates / room
    const mapping = await db.getReservationMappingBySkyHmsId(externalReservationId);
    if (mapping) {
      mapping.check_in = payload.checkIn || mapping.check_in;
      mapping.check_out = payload.checkOut || mapping.check_out;
      if (roomTypeId) {
        const roomMap = await roomMappingService.resolveExternalToInternal(roomTypeId);
        if (roomMap) mapping.room_name = roomMap.property_name;
      }
      await db.upsertReservationMapping(mapping);
    }
  }

  /**
   * Retry failed or pending outbound reservation synchronizations.
   */
  async retryFailedJobs() {
    const mappings = await db.getAllReservationMappings(100);
    const pendingJobs = mappings.filter(
      (m) => (m.sync_status === "pending" || m.sync_status === "failed") && m.origin === "CUSTOM_ENGINE"
    );

    auditLogger.info("RETRY_JOBS_START", `Found ${pendingJobs.length} pending/failed sync jobs to retry.`);

    const results = { total: pendingJobs.length, success: 0, failed: 0 };

    for (const job of pendingJobs) {
      try {
        const dummyBooking = {
          id: job.internal_booking_id,
          order_id: job.internal_order_id,
          room: job.room_name,
          check_in: job.check_in,
          check_out: job.check_out,
          origin: job.origin,
          name: "Guest (Pending Sync)",
          total_amount: 0,
        };

        const res = await this.syncWebsiteBookingToSkyHms(dummyBooking);
        if (res.ok) {
          results.success++;
        } else {
          results.failed++;
        }
      } catch (err) {
        results.failed++;
      }
    }

    auditLogger.info("RETRY_JOBS_COMPLETE", `Retry finished: ${results.success} succeeded, ${results.failed} failed.`, results);
    return results;
  }
}

module.exports = new ReservationSyncService();
