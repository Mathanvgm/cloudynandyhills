/**
 * backend/sync/db.js
 * Database access layer with graceful fallback for SkyHMS synchronization.
 * Interacts with Supabase using the service role key and falls back to
 * memory store if migration has not been applied yet.
 */

const auditLogger = require("./auditLogger");

class SyncDatabase {
  constructor() {
    this.supabase = null;
    this.tableSupport = {
      skyhms_room_mappings: null,
      skyhms_reservation_mappings: null,
      skyhms_sync_events: null,
      skyhms_config: null,
    };

    // In-memory fallbacks
    this.memRoomMappings = new Map();
    this.memReservationMappings = new Map();
    this.memSyncEvents = new Map();
    this.memConfig = new Map();
    this.memBookings = new Map();

    // Default room mappings seed for immediate usability
    this._seedDefaultMappings();
  }

  setClient(client) {
    this.supabase = client;
    auditLogger.setClient(client);
  }

  _seedDefaultMappings() {
    const defaults = [
      {
        id: "map-cnh-mcb",
        property_id: "c6f442bf-f465-40f2-9e91-96d5f18a27ad",
        property_name: "Mountain Cabin",
        skyhms_room_type_id: "MCB",
        skyhms_room_type_name: "Mountain View",
        rate_plan_id: "STD (CP)",
        total_inventory: 2,
        is_active: true,
        sync_mode: "two_way",
        last_verified_at: new Date().toISOString(),
      },
      {
        id: "map-cnh-dmv",
        property_id: "5a1dfa4b-2b63-4e0a-b923-f3856622f709",
        property_name: "Deluxe Mountain View",
        skyhms_room_type_id: "DMV",
        skyhms_room_type_name: "Dlx Mountain View",
        rate_plan_id: "STD (CP)",
        total_inventory: 3,
        is_active: true,
        sync_mode: "two_way",
        last_verified_at: new Date().toISOString(),
      },
      {
        id: "map-cnh-sfv",
        property_id: "e2c04731-8e24-4a0c-9cb5-5353ad448900",
        property_name: "Superior Afram Cabin (Superior Afram)",
        skyhms_room_type_id: "SFV",
        skyhms_room_type_name: "Superior Afram Cabin With Mountain View",
        rate_plan_id: "STD (CP)",
        total_inventory: 2,
        is_active: true,
        sync_mode: "two_way",
        last_verified_at: new Date().toISOString(),
      },
      {
        id: "map-cnh-dtwh",
        property_id: "1f88ab32-524d-47e5-8ce7-a2f9fd02e230",
        property_name: "WOODEN CABIN TWO BEDROOM (Dlx Wooden House)",
        skyhms_room_type_id: "DTWH",
        skyhms_room_type_name: "Wooden Cabin With Two Bedroom",
        rate_plan_id: "STD (CP)",
        total_inventory: 1,
        is_active: true,
        sync_mode: "two_way",
        last_verified_at: new Date().toISOString(),
      },
      {
        id: "map-cnh-ddm",
        property_id: "436ae43c-e4e8-4ac1-9f9f-9e3b2a1920e4",
        property_name: "Premium Family Cabin  Mountain View",
        skyhms_room_type_id: "DDM",
        skyhms_room_type_name: "Premium Room With Mountain View",
        rate_plan_id: "STD (CP)",
        total_inventory: 2,
        is_active: true,
        sync_mode: "two_way",
        last_verified_at: new Date().toISOString(),
      },
    ];

    defaults.forEach((m) => this.memRoomMappings.set(m.skyhms_room_type_id, m));
  }

  // ─── Room Mappings ──────────────────────────────────────────────────────────

  async getRoomMappings() {
    if (this.supabase && this.tableSupport.skyhms_room_mappings !== false) {
      try {
        const { data, error } = await this.supabase
          .from("skyhms_room_mappings")
          .select("*")
          .order("property_name", { ascending: true });

        if (!error && data) {
          this.tableSupport.skyhms_room_mappings = true;
          return data;
        }
        if (error && error.code === "42P01") {
          // Table does not exist
          this.tableSupport.skyhms_room_mappings = false;
        }
      } catch (err) {
        this.tableSupport.skyhms_room_mappings = false;
      }
    }
    return Array.from(this.memRoomMappings.values());
  }

  async getRoomMappingBySkyHmsId(skyHmsRoomTypeId) {
    const mappings = await this.getRoomMappings();
    return mappings.find(
      (m) =>
        m.skyhms_room_type_id.trim().toUpperCase() ===
        (skyHmsRoomTypeId || "").trim().toUpperCase()
    );
  }

  async getRoomMappingByPropertyName(propertyName) {
    const mappings = await this.getRoomMappings();
    const cleanName = (propertyName || "").trim().toLowerCase();
    return mappings.find(
      (m) => (m.property_name || "").trim().toLowerCase() === cleanName
    );
  }

  async upsertRoomMapping(mappingData) {
    const record = {
      property_id: mappingData.property_id || mappingData.propertyId,
      property_name: mappingData.property_name || mappingData.propertyName,
      skyhms_room_type_id: mappingData.skyhms_room_type_id || mappingData.skyHmsRoomTypeId,
      skyhms_room_type_name: mappingData.skyhms_room_type_name || mappingData.skyHmsRoomTypeName || "",
      rate_plan_id: mappingData.rate_plan_id || mappingData.ratePlanId || "STANDARD",
      total_inventory: Number(mappingData.total_inventory ?? mappingData.totalInventory ?? 1),
      is_active: mappingData.is_active !== undefined ? Boolean(mappingData.is_active) : true,
      sync_mode: mappingData.sync_mode || mappingData.syncMode || "two_way",
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (this.supabase && this.tableSupport.skyhms_room_mappings === true) {
      try {
        const { data, error } = await this.supabase
          .from("skyhms_room_mappings")
          .upsert(record, { onConflict: "skyhms_room_type_id" })
          .select();
        if (!error && data && data.length) return data[0];
      } catch (err) {
        // fallback to memory
      }
    }

    record.id = mappingData.id || `map-${Date.now()}`;
    record.created_at = record.created_at || new Date().toISOString();
    this.memRoomMappings.set(record.skyhms_room_type_id, record);
    return record;
  }

  async deleteRoomMapping(idOrSkyHmsCode) {
    if (this.supabase && this.tableSupport.skyhms_room_mappings === true) {
      try {
        await this.supabase
          .from("skyhms_room_mappings")
          .delete()
          .or(`id.eq.${idOrSkyHmsCode},skyhms_room_type_id.eq.${idOrSkyHmsCode}`);
      } catch (e) {}
    }

    // delete from memory
    for (const [key, val] of this.memRoomMappings.entries()) {
      if (val.id === idOrSkyHmsCode || key === idOrSkyHmsCode) {
        this.memRoomMappings.delete(key);
        return true;
      }
    }
    return true;
  }

  // ─── Reservation Mappings ───────────────────────────────────────────────────

  async getReservationMappingByOrderId(orderId) {
    if (this.supabase && this.tableSupport.skyhms_reservation_mappings !== false) {
      try {
        const { data, error } = await this.supabase
          .from("skyhms_reservation_mappings")
          .select("*")
          .eq("internal_order_id", orderId)
          .maybeSingle();

        if (!error && data) return data;
      } catch (e) {}
    }
    return this.memReservationMappings.get(orderId) || null;
  }

  async getReservationMappingBySkyHmsId(skyHmsId) {
    if (this.supabase && this.tableSupport.skyhms_reservation_mappings !== false) {
      try {
        const { data, error } = await this.supabase
          .from("skyhms_reservation_mappings")
          .select("*")
          .eq("skyhms_reservation_id", skyHmsId)
          .maybeSingle();

        if (!error && data) return data;
      } catch (e) {}
    }
    for (const val of this.memReservationMappings.values()) {
      if (val.skyhms_reservation_id === skyHmsId) return val;
    }
    return null;
  }

  async upsertReservationMapping(mapping) {
    const record = {
      internal_booking_id: mapping.internal_booking_id || null,
      internal_order_id: mapping.internal_order_id,
      skyhms_reservation_id: mapping.skyhms_reservation_id || null,
      skyhms_confirmation_no: mapping.skyhms_confirmation_no || null,
      room_name: mapping.room_name,
      skyhms_room_type_id: mapping.skyhms_room_type_id || null,
      check_in: mapping.check_in,
      check_out: mapping.check_out,
      origin: mapping.origin || "CUSTOM_ENGINE",
      sync_status: mapping.sync_status || "synced",
      retry_count: Number(mapping.retry_count || 0),
      last_error: mapping.last_error || null,
      payload: mapping.payload || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (this.supabase && this.tableSupport.skyhms_reservation_mappings !== false) {
      try {
        const { data, error } = await this.supabase
          .from("skyhms_reservation_mappings")
          .upsert(record, { onConflict: "internal_order_id" })
          .select();

        if (!error && data && data.length) {
          this.tableSupport.skyhms_reservation_mappings = true;
          return data[0];
        }
      } catch (e) {
        this.tableSupport.skyhms_reservation_mappings = false;
      }
    }

    record.id = mapping.id || `resmap-${Date.now()}`;
    record.created_at = record.created_at || new Date().toISOString();
    this.memReservationMappings.set(record.internal_order_id, record);
    return record;
  }

  async getAllReservationMappings(limit = 100) {
    if (this.supabase && this.tableSupport.skyhms_reservation_mappings === true) {
      try {
        const { data } = await this.supabase
          .from("skyhms_reservation_mappings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (data) return data;
      } catch (e) {}
    }
    return Array.from(this.memReservationMappings.values()).slice(0, limit);
  }

  // ─── Webhook & Sync Events (Deduplication) ───────────────────────────────────

  async recordSyncEvent(eventId, eventType, payload, status = "processed", errorMessage = null) {
    const record = {
      event_id: eventId,
      event_type: eventType,
      status,
      payload: payload ? (typeof payload === "object" ? payload : { raw: payload }) : null,
      error_message: errorMessage,
      received_at: new Date().toISOString(),
      processed_at: status === "processed" ? new Date().toISOString() : null,
    };

    if (this.supabase && this.tableSupport.skyhms_sync_events !== false) {
      try {
        const { error } = await this.supabase
          .from("skyhms_sync_events")
          .insert([record]);
        if (!error) {
          this.tableSupport.skyhms_sync_events = true;
          return true;
        }
      } catch (e) {
        this.tableSupport.skyhms_sync_events = false;
      }
    }

    this.memSyncEvents.set(eventId, record);
    return true;
  }

  async isEventProcessed(eventId) {
    if (!eventId) return false;
    if (this.supabase && this.tableSupport.skyhms_sync_events === true) {
      try {
        const { data } = await this.supabase
          .from("skyhms_sync_events")
          .select("id, status")
          .eq("event_id", eventId)
          .maybeSingle();

        if (data && data.status === "processed") return true;
      } catch (e) {}
    }
    const mem = this.memSyncEvents.get(eventId);
    return !!(mem && mem.status === "processed");
  }

  // ─── Bookings table direct helpers ──────────────────────────────────────────

  async getConfirmedBookings() {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("bookings")
        .select("*")
        .eq("status", "confirmed");
      if (!error && data) return data;
    }
    return [];
  }

  async insertBookingFromSkyHms(bookingData) {
    const orderId = `SKY-${bookingData.externalReservationId || Date.now()}`;
    const newBooking = {
      name: bookingData.guestName || "SkyHMS Guest",
      email: bookingData.guestEmail || null,
      phone: bookingData.guestPhone || "0000000000",
      room: bookingData.roomName,
      check_in: bookingData.checkIn,
      check_out: bookingData.checkOut,
      adults: Number(bookingData.adults || 1),
      children: Number(bookingData.children || 0),
      requests: bookingData.remarks ? `SkyHMS Sync: ${bookingData.remarks}` : "Booked via SkyHMS / OTA",
      total_amount: Number(bookingData.totalAmount || 0),
      status: "confirmed",
      order_id: orderId,
      booked_at: new Date().toISOString(),
      origin: "SKYHMS",
      skyhms_reservation_id: bookingData.externalReservationId,
      skyhms_sync_status: "synced",
    };

    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("bookings")
        .insert([newBooking])
        .select();
      if (!error && data && data.length) return data[0];
      if (error) throw new Error(error.message);
    }
    return Object.assign({ id: `bk-${Date.now()}` }, newBooking);
  }

  async cancelBookingBySkyHmsId(skyHmsId) {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("bookings")
        .update({ status: "cancelled", skyhms_sync_status: "cancelled" })
        .eq("skyhms_reservation_id", skyHmsId)
        .select();
      if (!error && data && data.length) return data[0];
    }
    return null;
  }

  // ─── Automated Sync Inventory Blocks ────────────────────────────────────────

  /**
   * Fetch all active auto-blocks placed from SkyHMS.
   */
  async getSkyHmsAutoBlocks() {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from("bookings")
          .select("*")
          .eq("origin", "SKYHMS")
          .ilike("order_id", "SKYHMS-AUTO-%")
          .eq("status", "confirmed");
        if (!error && data) return data;
      } catch (e) {}
    }

    return Array.from(this.memBookings.values()).filter(
      (b) =>
        b.origin === "SKYHMS" &&
        b.order_id &&
        b.order_id.startsWith("SKYHMS-AUTO-") &&
        b.status === "confirmed"
    );
  }

  /**
   * Block a room date locally when booked/unavailable on SkyHMS.
   */
  async upsertSkyHmsAutoBlock({ roomName, roomCode, checkIn, checkOut }) {
    const orderId = `SKYHMS-AUTO-${roomCode}-${checkIn}`;

    if (this.supabase) {
      try {
        // Check if existing block exists
        const { data: existing } = await this.supabase
          .from("bookings")
          .select("*")
          .eq("order_id", orderId)
          .maybeSingle();

        if (existing) {
          if (existing.status !== "confirmed") {
            const { data: updated } = await this.supabase
              .from("bookings")
              .update({ status: "confirmed", booked_at: new Date().toISOString() })
              .eq("order_id", orderId)
              .select();
            return { action: "re-activated", booking: updated ? updated[0] : existing };
          }
          return { action: "already_blocked", booking: existing };
        }

        // Insert new block
        const newBlock = {
          name: "SkyHMS Reserved / Blocked",
          email: null,
          phone: "0000000000",
          room: roomName,
          check_in: checkIn,
          check_out: checkOut,
          adults: 1,
          children: 0,
          requests: `Auto-synced from SkyHMS (Room: ${roomCode})`,
          total_amount: 0,
          status: "confirmed",
          order_id: orderId,
          booked_at: new Date().toISOString(),
          origin: "SKYHMS",
          skyhms_reservation_id: `SKYHMS-AUTO-${roomCode}-${checkIn}`,
          skyhms_sync_status: "synced",
        };

        const { data: inserted, error: insertError } = await this.supabase
          .from("bookings")
          .insert([newBlock])
          .select();

        if (!insertError && inserted && inserted.length) {
          return { action: "created", booking: inserted[0] };
        }
      } catch (err) {
        auditLogger.warn("AUTO_BLOCK_DB_FAIL", `Database block insert failed: ${err.message}`);
      }
    }

    // In-memory fallback
    const memExisting = this.memBookings.get(orderId);
    if (memExisting) {
      memExisting.status = "confirmed";
      return { action: "re-activated", booking: memExisting };
    }

    const memBlock = {
      id: `bk-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "SkyHMS Reserved / Blocked",
      email: null,
      phone: "0000000000",
      room: roomName,
      check_in: checkIn,
      check_out: checkOut,
      adults: 1,
      children: 0,
      requests: `Auto-synced from SkyHMS (Room: ${roomCode})`,
      total_amount: 0,
      status: "confirmed",
      order_id: orderId,
      booked_at: new Date().toISOString(),
      origin: "SKYHMS",
      skyhms_reservation_id: `SKYHMS-AUTO-${roomCode}-${checkIn}`,
      skyhms_sync_status: "synced",
    };
    this.memBookings.set(orderId, memBlock);
    return { action: "created", booking: memBlock };
  }

  /**
   * Release an auto-block when a room becomes available again on SkyHMS.
   */
  async releaseSkyHmsAutoBlock({ roomCode, checkIn }) {
    const orderId = `SKYHMS-AUTO-${roomCode}-${checkIn}`;

    if (this.supabase) {
      try {
        const { data: updated, error } = await this.supabase
          .from("bookings")
          .update({ status: "cancelled", skyhms_sync_status: "released" })
          .eq("order_id", orderId)
          .eq("status", "confirmed")
          .select();

        if (!error && updated && updated.length) {
          return { released: true, orderId };
        }
      } catch (err) {
        auditLogger.warn("AUTO_RELEASE_DB_FAIL", `Database release failed: ${err.message}`);
      }
    }

    const mem = this.memBookings.get(orderId);
    if (mem && mem.status === "confirmed") {
      mem.status = "cancelled";
      return { released: true, orderId };
    }

    return { released: false, orderId };
  }
}

module.exports = new SyncDatabase();
