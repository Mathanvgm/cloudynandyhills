/**
 * backend/sync/adapters/skyHmsAdapterInterface.js
 * Canonical interface definition for SkyHMS Property Management System integration.
 */

class SkyHmsAdapterInterface {
  /**
   * Test connectivity and authentication to SkyHMS.
   * @returns {Promise<{ ok: boolean, latencyMs: number, message: string, details?: any }>}
   */
  async testConnection() {
    throw new Error("Method testConnection() must be implemented.");
  }

  /**
   * Fetch room types configured in SkyHMS.
   * @returns {Promise<Array<{ roomTypeId: string, roomTypeName: string, baseCapacity: number, maxCapacity: number, totalUnits: number, isActive: boolean }>>}
   */
  async getRoomTypes() {
    throw new Error("Method getRoomTypes() must be implemented.");
  }

  /**
   * Check room availability for a date range in SkyHMS.
   * @param {string} roomTypeId - SkyHMS Room Type ID
   * @param {string} checkIn - ISO date 'YYYY-MM-DD'
   * @param {string} checkOut - ISO date 'YYYY-MM-DD'
   * @param {number} numberOfRooms - Number of rooms requested
   * @returns {Promise<{ available: boolean, availableUnits: number, roomTypeId: string, checkIn: string, checkOut: string, restrictions?: any }>}
   */
  async checkAvailability(roomTypeId, checkIn, checkOut, numberOfRooms = 1) {
    throw new Error("Method checkAvailability() must be implemented.");
  }

  /**
   * Check room availability across all configured room types for a date range.
   * Default implementation invokes checkAvailability for each room type.
   * Specific adapters (e.g. SkyRoomsLiveAdapter) override this with a single HTTP request.
   * @param {string} checkIn - ISO date 'YYYY-MM-DD'
   * @param {string} checkOut - ISO date 'YYYY-MM-DD'
   * @returns {Promise<Array<{ roomTypeId: string, available: boolean, availableUnits: number }>>}
   */
  async checkAllRoomsAvailability(checkIn, checkOut) {
    const roomTypes = await this.getRoomTypes();
    const results = [];
    for (const rt of roomTypes) {
      try {
        const res = await this.checkAvailability(rt.roomTypeId, checkIn, checkOut, 1);
        results.push({
          roomTypeId: rt.roomTypeId,
          available: res.available,
          availableUnits: res.availableUnits,
        });
      } catch (err) {
        results.push({
          roomTypeId: rt.roomTypeId,
          available: true,
          availableUnits: rt.totalUnits || 1,
          error: err.message,
        });
      }
    }
    return results;
  }

  /**
   * Fetch daily inventory and rate calendar across a date range.
   * @param {string} startDate - ISO date 'YYYY-MM-DD'
   * @param {string} endDate - ISO date 'YYYY-MM-DD'
   * @returns {Promise<Array<{ date: string, roomTypeId: string, available: number, booked: number, blocked: number, rate: number }>>}
   */
  async getInventory(startDate, endDate) {
    throw new Error("Method getInventory() must be implemented.");
  }

  /**
   * Create a reservation in SkyHMS.
   * @param {Object} reservationData
   * @param {string} reservationData.reservationId - Unique internal ID (Idempotency Key)
   * @param {string} reservationData.roomTypeId - SkyHMS Room Type ID
   * @param {string} reservationData.checkIn - ISO date 'YYYY-MM-DD'
   * @param {string} reservationData.checkOut - ISO date 'YYYY-MM-DD'
   * @param {number} reservationData.numberOfRooms - Room count
   * @param {string} reservationData.guestName - Primary guest full name
   * @param {string} reservationData.guestEmail - Primary guest email
   * @param {string} reservationData.guestPhone - Primary guest phone
   * @param {number} reservationData.adults - Number of adults
   * @param {number} reservationData.children - Number of children
   * @param {number} reservationData.totalAmount - Amount paid / payable
   * @param {string} [reservationData.ratePlanId] - Rate plan
   * @param {string} [reservationData.remarks] - Special requests / notes
   * @returns {Promise<{ ok: boolean, externalReservationId: string, confirmationNo: string, status: string }>}
   */
  async createReservation(reservationData) {
    throw new Error("Method createReservation() must be implemented.");
  }

  /**
   * Modify an existing reservation in SkyHMS.
   * @param {string} externalReservationId - SkyHMS Reservation ID
   * @param {Object} updates - Updated dates, room type, guest details
   * @returns {Promise<{ ok: boolean, externalReservationId: string, status: string }>}
   */
  async updateReservation(externalReservationId, updates) {
    throw new Error("Method updateReservation() must be implemented.");
  }

  /**
   * Cancel a reservation in SkyHMS.
   * @param {string} externalReservationId - SkyHMS Reservation ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<{ ok: boolean, externalReservationId: string, status: string }>}
   */
  async cancelReservation(externalReservationId, reason) {
    throw new Error("Method cancelReservation() must be implemented.");
  }

  /**
   * Push inventory updates or manual date blocks to SkyHMS.
   * @param {string} roomTypeId - SkyHMS Room Type ID
   * @param {Array<{ date: string, sellableUnits: number, isBlocked?: boolean }>} dates
   * @returns {Promise<{ ok: boolean, updatedCount: number }>}
   */
  async pushInventoryUpdate(roomTypeId, dates) {
    throw new Error("Method pushInventoryUpdate() must be implemented.");
  }
}

module.exports = SkyHmsAdapterInterface;
