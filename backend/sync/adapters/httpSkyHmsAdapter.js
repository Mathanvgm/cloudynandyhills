/**
 * backend/sync/adapters/httpSkyHmsAdapter.js
 * Production HTTP Client for SkyHMS REST APIs.
 * Connects to live SkyHMS / SkyChannels server once credentials are provisioned.
 */

const SkyHmsAdapterInterface = require("./skyHmsAdapterInterface");
const config = require("../config");
const auditLogger = require("../auditLogger");

class HttpSkyHmsAdapter extends SkyHmsAdapterInterface {
  constructor(customConfig = {}) {
    super();
    this.name = "HttpSkyHmsAdapter";
    this.isMock = false;

    this.baseUrl = customConfig.apiBaseUrl || config.apiBaseUrl;
    this.apiKey = customConfig.apiKey || config.apiKey;
    this.hotelCode = customConfig.hotelCode || config.hotelCode;
    this.timeoutMs = customConfig.apiTimeoutMs || config.apiTimeoutMs;
  }

  _getHeaders() {
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-SkyHMS-API-Key": this.apiKey,
      "X-SkyHMS-Hotel-Code": this.hotelCode,
      "Authorization": `Bearer ${this.apiKey}`,
      "User-Agent": "Cloudnandy-BookingEngine/1.0 (VGM SOFT TECH)",
    };
  }

  async _request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const options = {
      method,
      headers: this._getHeaders(),
      signal: controller.signal,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        auditLogger.error("HTTP_SKYHMS_FAIL", `Request to ${endpoint} returned HTTP ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          response: errorText.slice(0, 500),
        });
        throw new Error(`SkyHMS API error [${response.status}]: ${response.statusText} - ${errorText.slice(0, 200)}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        auditLogger.error("HTTP_SKYHMS_TIMEOUT", `Request to ${endpoint} timed out after ${this.timeoutMs}ms`);
        throw new Error(`SkyHMS API request timed out (${this.timeoutMs}ms)`);
      }
      throw err;
    }
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await this._request("/health");
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: "Successfully connected to live SkyHMS endpoint",
        details: res,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: `SkyHMS connection failed: ${err.message}`,
        details: { url: this.baseUrl, hotelCode: this.hotelCode },
      };
    }
  }

  async getRoomTypes() {
    const res = await this._request(`/properties/${this.hotelCode}/room-types`);
    return res.data || res.roomTypes || res;
  }

  async checkAvailability(roomTypeId, checkIn, checkOut, numberOfRooms = 1) {
    const query = new URLSearchParams({
      roomTypeId,
      checkIn,
      checkOut,
      rooms: String(numberOfRooms),
      hotelCode: this.hotelCode,
    });
    return await this._request(`/availability?${query.toString()}`);
  }

  async getInventory(startDate, endDate) {
    const query = new URLSearchParams({
      hotelCode: this.hotelCode,
      startDate,
      endDate,
    });
    return await this._request(`/inventory?${query.toString()}`);
  }

  async createReservation(reservationData) {
    const payload = {
      hotelCode: this.hotelCode,
      partnerReservationId: reservationData.reservationId,
      roomTypeId: reservationData.roomTypeId,
      checkIn: reservationData.checkIn,
      checkOut: reservationData.checkOut,
      numberOfRooms: reservationData.numberOfRooms || 1,
      guest: {
        name: reservationData.guestName,
        email: reservationData.guestEmail,
        phone: reservationData.guestPhone,
        adults: reservationData.adults,
        children: reservationData.children,
      },
      pricing: {
        totalAmount: reservationData.totalAmount,
        currency: "INR",
        ratePlanId: reservationData.ratePlanId || "STANDARD",
      },
      remarks: reservationData.remarks,
      source: "CLOUDNANDY_DIRECT_ENGINE",
    };

    const res = await this._request("/reservations", "POST", payload);
    return {
      ok: true,
      externalReservationId: res.reservationId || res.id || res.externalReservationId,
      confirmationNo: res.confirmationNo || res.confirmation_number || res.bookingRef,
      status: res.status || "CONFIRMED",
    };
  }

  async updateReservation(externalReservationId, updates) {
    return await this._request(`/reservations/${externalReservationId}`, "PUT", updates);
  }

  async cancelReservation(externalReservationId, reason) {
    return await this._request(`/reservations/${externalReservationId}/cancel`, "POST", { reason });
  }

  async pushInventoryUpdate(roomTypeId, dates) {
    return await this._request(`/inventory/bulk-update`, "POST", {
      hotelCode: this.hotelCode,
      roomTypeId,
      updates: dates,
    });
  }
}

module.exports = HttpSkyHmsAdapter;
