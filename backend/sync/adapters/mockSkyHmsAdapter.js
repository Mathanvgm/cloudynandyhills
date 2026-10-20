/**
 * backend/sync/adapters/mockSkyHmsAdapter.js
 * High-fidelity, stateful mock implementation of SkyHMS PMS.
 * Used for local testing, staging, and when live vendor credentials are pending.
 */

const SkyHmsAdapterInterface = require("./skyHmsAdapterInterface");
const auditLogger = require("../auditLogger");

class MockSkyHmsAdapter extends SkyHmsAdapterInterface {
  constructor() {
    super();
    this.name = "MockSkyHmsAdapter";
    this.isMock = true;

    // Simulation controls
    this.simulateLatencyMs = 25;
    this.simulateDowntime = false;
    this.simulateAuthFailure = false;
    this.simulateRandomFailures = false;

    // Simulated SkyHMS Room Inventory
    this.roomTypes = [
      // Verified Live SkyRooms Room Types (bkgpropid 1035)
      {
        roomTypeId: "MCB",
        roomTypeName: "Mountain View",
        baseCapacity: 2,
        maxCapacity: 3,
        totalUnits: 2,
        isActive: true,
      },
      {
        roomTypeId: "DMV",
        roomTypeName: "Dlx Mountain View",
        baseCapacity: 2,
        maxCapacity: 3,
        totalUnits: 3,
        isActive: true,
      },
      {
        roomTypeId: "SFV",
        roomTypeName: "Superior Afram Cabin With Mountain View",
        baseCapacity: 4,
        maxCapacity: 5,
        totalUnits: 2,
        isActive: true,
      },
      {
        roomTypeId: "DTWH",
        roomTypeName: "Wooden Cabin With Two Bedroom",
        baseCapacity: 2,
        maxCapacity: 3,
        totalUnits: 1,
        isActive: true,
      },
      {
        roomTypeId: "DDM",
        roomTypeName: "Premium Room With Mountain View",
        baseCapacity: 4,
        maxCapacity: 5,
        totalUnits: 2,
        isActive: true,
      },
    ];

    // Simulated external reservations table in SkyHMS
    // Key: externalReservationId
    this.reservations = new Map();

    // Idempotency cache: reservationId (internal order id) -> externalReservationId
    this.idempotencyMap = new Map();

    // Manual blocks: Map<`${roomTypeId}_${date}`, boolean>
    this.dateBlocks = new Map();
  }

  async _simulateDelay() {
    if (this.simulateLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulateLatencyMs));
    }
    if (this.simulateDowntime) {
      throw new Error("SkyHMS Service Unavailable (HTTP 503 Gateway Timeout)");
    }
    if (this.simulateAuthFailure) {
      throw new Error("SkyHMS Unauthorized: Invalid API Key or Property Code (HTTP 401)");
    }
  }

  async testConnection() {
    const start = Date.now();
    await this._simulateDelay();
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: "Connected to SkyHMS Mock Gateway (Cloudnandy Resort, Poombarai)",
      details: {
        vendor: "Raspberry InfoSystems / SkyHMS",
        hotelCode: "CLOUDNANDY_KODAI",
        mode: "mock_sandbox",
        activeRoomTypes: this.roomTypes.length,
        totalActiveReservations: Array.from(this.reservations.values()).filter(
          (r) => r.status === "CONFIRMED"
        ).length,
      },
    };
  }

  async getRoomTypes() {
    await this._simulateDelay();
    return this.roomTypes;
  }

  /**
   * Calculate how many units of a room type are booked/blocked on a given date.
   */
  _getOccupiedUnitsOnDate(roomTypeId, dateStr) {
    const targetDate = new Date(dateStr + "T00:00:00");
    let count = 0;

    // Check manual blocks
    if (this.dateBlocks.get(`${roomTypeId}_${dateStr}`)) {
      return 9999; // effectively fully blocked
    }

    for (const res of this.reservations.values()) {
      if (res.roomTypeId !== roomTypeId) continue;
      if (res.status === "CANCELLED") continue;

      const inDate = new Date(res.checkIn + "T00:00:00");
      const outDate = new Date(res.checkOut + "T00:00:00");

      // Stay covers night if targetDate >= inDate and targetDate < outDate
      if (targetDate >= inDate && targetDate < outDate) {
        count += Number(res.numberOfRooms || 1);
      }
    }
    return count;
  }

  async checkAvailability(roomTypeId, checkIn, checkOut, numberOfRooms = 1) {
    await this._simulateDelay();

    const roomType = this.roomTypes.find((r) => r.roomTypeId === roomTypeId);
    if (!roomType) {
      throw new Error(`Room type '${roomTypeId}' not found in SkyHMS.`);
    }

    const s = new Date(checkIn + "T00:00:00");
    const e = new Date(checkOut + "T00:00:00");

    if (isNaN(s) || isNaN(e) || e <= s) {
      throw new Error("Invalid check-in/check-out dates.");
    }

    let minAvailableUnits = roomType.totalUnits;

    const toYMD = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Iterate through each night of the requested stay
    const cur = new Date(s);
    while (cur < e) {
      const dateStr = toYMD(cur);
      const occupied = this._getOccupiedUnitsOnDate(roomTypeId, dateStr);
      const available = Math.max(0, roomType.totalUnits - occupied);
      if (available < minAvailableUnits) {
        minAvailableUnits = available;
      }
      cur.setDate(cur.getDate() + 1);
    }

    return {
      available: minAvailableUnits >= numberOfRooms,
      availableUnits: minAvailableUnits,
      roomTypeId,
      checkIn,
      checkOut,
      totalUnits: roomType.totalUnits,
      requestedRooms: numberOfRooms,
    };
  }

  async getInventory(startDate, endDate) {
    await this._simulateDelay();
    const inventory = [];

    const toYMD = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const s = new Date(startDate + "T00:00:00");
    const e = new Date(endDate + "T00:00:00");

    for (const room of this.roomTypes) {
      const cur = new Date(s);
      while (cur <= e) {
        const dateStr = toYMD(cur);
        const occupied = this._getOccupiedUnitsOnDate(room.roomTypeId, dateStr);
        const isBlocked = !!this.dateBlocks.get(`${room.roomTypeId}_${dateStr}`);
        const available = isBlocked ? 0 : Math.max(0, room.totalUnits - occupied);

        inventory.push({
          date: dateStr,
          roomTypeId: room.roomTypeId,
          roomTypeName: room.roomTypeName,
          totalUnits: room.totalUnits,
          occupiedUnits: occupied,
          availableUnits: available,
          isBlocked,
          baseRate: 4999, // default reference
        });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return inventory;
  }

  async createReservation(reservationData) {
    await this._simulateDelay();

    const {
      reservationId, // Idempotency key from custom booking engine
      roomTypeId,
      checkIn,
      checkOut,
      numberOfRooms = 1,
      guestName,
      guestEmail,
      guestPhone,
      adults = 2,
      children = 0,
      totalAmount = 0,
      ratePlanId = "STANDARD",
      remarks = "",
    } = reservationData;

    // 1. Idempotency Check: if already created with this reservationId, return existing
    if (reservationId && this.idempotencyMap.has(reservationId)) {
      const existingId = this.idempotencyMap.get(reservationId);
      const existing = this.reservations.get(existingId);
      if (existing) {
        auditLogger.info("MOCK_IDEMPOTENT_RES", `Idempotent request returning existing reservation ${existingId}`);
        return {
          ok: true,
          externalReservationId: existing.externalReservationId,
          confirmationNo: existing.confirmationNo,
          status: existing.status,
          isIdempotentReplay: true,
        };
      }
    }

    // 2. Availability validation
    const avail = await this.checkAvailability(roomTypeId, checkIn, checkOut, numberOfRooms);
    if (!avail.available) {
      auditLogger.warn("MOCK_OVERBOOK_PREVENTED", `Declined SkyHMS reservation for ${roomTypeId}: 0 sellable units.`);
      throw new Error(`Insufficient inventory: SkyHMS has ${avail.availableUnits} unit(s) available for requested dates.`);
    }

    // 3. Create Reservation
    const externalReservationId = `SKY-RES-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const confirmationNo = `CNH-SKY-${Math.floor(Math.random() * 89999 + 10000)}`;

    const record = {
      externalReservationId,
      confirmationNo,
      internalReservationId: reservationId,
      roomTypeId,
      checkIn,
      checkOut,
      numberOfRooms,
      guestName,
      guestEmail,
      guestPhone,
      adults,
      children,
      totalAmount,
      ratePlanId,
      remarks,
      status: "CONFIRMED",
      source: "CUSTOM_ENGINE_INTEGRATION",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.reservations.set(externalReservationId, record);
    if (reservationId) {
      this.idempotencyMap.set(reservationId, externalReservationId);
    }

    auditLogger.info("MOCK_RES_CREATED", `SkyHMS Reservation ${externalReservationId} confirmed for ${guestName}`);

    return {
      ok: true,
      externalReservationId,
      confirmationNo,
      status: "CONFIRMED",
    };
  }

  async updateReservation(externalReservationId, updates) {
    await this._simulateDelay();

    const existing = this.reservations.get(externalReservationId);
    if (!existing) {
      throw new Error(`Reservation ${externalReservationId} not found in SkyHMS.`);
    }

    // Check availability if dates changed
    if (updates.checkIn || updates.checkOut || updates.roomTypeId) {
      const roomType = updates.roomTypeId || existing.roomTypeId;
      const cIn = updates.checkIn || existing.checkIn;
      const cOut = updates.checkOut || existing.checkOut;
      
      // Temporarily set existing to cancelled to avoid self-conflict
      existing.status = "CANCELLED";
      const avail = await this.checkAvailability(roomType, cIn, cOut, existing.numberOfRooms);
      existing.status = "CONFIRMED";

      if (!avail.available) {
        throw new Error(`Cannot update dates: insufficient inventory on requested dates.`);
      }

      existing.roomTypeId = roomType;
      existing.checkIn = cIn;
      existing.checkOut = cOut;
    }

    if (updates.guestName) existing.guestName = updates.guestName;
    if (updates.guestPhone) existing.guestPhone = updates.guestPhone;
    if (updates.guestEmail) existing.guestEmail = updates.guestEmail;
    if (updates.status) existing.status = updates.status;
    existing.updatedAt = new Date().toISOString();

    return {
      ok: true,
      externalReservationId,
      status: existing.status,
    };
  }

  async cancelReservation(externalReservationId, reason = "Guest cancellation") {
    await this._simulateDelay();

    const existing = this.reservations.get(externalReservationId);
    if (!existing) {
      throw new Error(`Reservation ${externalReservationId} not found in SkyHMS.`);
    }

    existing.status = "CANCELLED";
    existing.cancellationReason = reason;
    existing.cancelledAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();

    auditLogger.info("MOCK_RES_CANCELLED", `SkyHMS Reservation ${externalReservationId} cancelled: ${reason}`);

    return {
      ok: true,
      externalReservationId,
      status: "CANCELLED",
    };
  }

  async pushInventoryUpdate(roomTypeId, dates) {
    await this._simulateDelay();
    let count = 0;

    for (const item of dates) {
      if (item.isBlocked !== undefined) {
        this.dateBlocks.set(`${roomTypeId}_${item.date}`, item.isBlocked);
        count++;
      }
    }

    return { ok: true, updatedCount: count };
  }

  /**
   * Helper to simulate a reservation originating directly on SkyHMS or an OTA
   * (e.g. Booking.com / MakeMyTrip via SkyChannels).
   */
  simulateExternalBooking({
    roomTypeId,
    checkIn,
    checkOut,
    guestName = "OTA Guest",
    guestEmail = "otaguest@example.com",
    guestPhone = "9876543210",
    numberOfRooms = 1,
    channel = "MakeMyTrip",
  }) {
    const externalReservationId = `SKY-OTA-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const confirmationNo = `OTA-${Math.floor(Math.random() * 89999 + 10000)}`;

    const record = {
      externalReservationId,
      confirmationNo,
      roomTypeId,
      checkIn,
      checkOut,
      numberOfRooms,
      guestName,
      guestEmail,
      guestPhone,
      adults: 2,
      children: 0,
      totalAmount: 9500,
      status: "CONFIRMED",
      source: `OTA_${channel.toUpperCase()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.reservations.set(externalReservationId, record);
    return record;
  }
}

module.exports = MockSkyHmsAdapter;
