/**
 * backend/sync/adapters/adapterFactory.js
 * Factory to instantiate and resolve the active SkyHMS adapter.
 */

const config = require("../config");
const MockSkyHmsAdapter = require("./mockSkyHmsAdapter");
const HttpSkyHmsAdapter = require("./httpSkyHmsAdapter");
const SkyRoomsLiveAdapter = require("./skyRoomsLiveAdapter");
const auditLogger = require("../auditLogger");

let mockInstance = null;
let httpInstance = null;
let liveSkyRoomsInstance = null;

function getSkyHmsAdapter(forceMock = null) {
  const shouldUseMock = forceMock !== null ? forceMock : config.useMock;

  if (shouldUseMock) {
    if (!mockInstance) {
      mockInstance = new MockSkyHmsAdapter();
      auditLogger.info("ADAPTER_INIT", "Initialized MockSkyHmsAdapter for local testing / staging.");
    }
    return mockInstance;
  }

  // If live API key is set, use the REST API adapter
  if (config.apiKey && config.apiKey !== "mock") {
    if (!httpInstance) {
      httpInstance = new HttpSkyHmsAdapter();
      auditLogger.info("ADAPTER_INIT", `Initialized live HttpSkyHmsAdapter targeting ${config.apiBaseUrl}`);
    }
    return httpInstance;
  }

  // Direct live booking engine adapter for https://bookings.skyrooms.in/roombooking?bkgpropid=1035
  if (!liveSkyRoomsInstance) {
    liveSkyRoomsInstance = new SkyRoomsLiveAdapter({ propertyId: config.hotelCode || "1035" });
    auditLogger.info(
      "ADAPTER_INIT",
      `Initialized SkyRoomsLiveAdapter connected directly to ${config.bookingUrl || "https://bookings.skyrooms.in/roombooking?bkgpropid=1035"}`
    );
  }
  return liveSkyRoomsInstance;
}

module.exports = {
  getSkyHmsAdapter,
  getMockAdapter: () => {
    if (!mockInstance) mockInstance = new MockSkyHmsAdapter();
    return mockInstance;
  },
};
