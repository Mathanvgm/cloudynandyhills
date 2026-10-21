/**
 * backend/sync/routes/syncRoutes.js
 * Express router exposing SkyHMS inventory sync endpoints, admin APIs, and webhook listener.
 */

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { getSkyHmsAdapter, getMockAdapter } = require("../adapters/adapterFactory");
const roomMappingService = require("../services/roomMappingService");
const inventorySyncService = require("../services/inventorySyncService");
const reservationSyncService = require("../services/reservationSyncService");
const reconciliationService = require("../services/reconciliationService");
const db = require("../db");
const auditLogger = require("../auditLogger");
const config = require("../config");

// ─── Status & Connection Test ──────────────────────────────────────────────────

router.get("/status", async (_req, res) => {
  try {
    const status = await reconciliationService.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/test-connection", async (_req, res) => {
  try {
    const adapter = getSkyHmsAdapter();
    const result = await adapter.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Room Mappings ─────────────────────────────────────────────────────────────

router.get("/mappings", async (_req, res) => {
  try {
    const mappings = await roomMappingService.getAllMappings();
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/mappings", async (req, res) => {
  try {
    const saved = await roomMappingService.saveMapping(req.body);
    res.status(201).json({ ok: true, mapping: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/mappings/:id", async (req, res) => {
  try {
    await roomMappingService.deleteMapping(req.params.id);
    res.json({ ok: true, message: "Mapping removed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reconciliation & Retries ──────────────────────────────────────────────────

router.post("/reconcile", async (req, res) => {
  try {
    const dryRun = req.body && req.body.dryRun === true;
    const result = await reconciliationService.runReconciliation({ isDryRun: dryRun });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/sync-rates", async (_req, res) => {
  try {
    const result = await reconciliationService.syncLiveRatesAndRooms();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/retry-failed", async (_req, res) => {
  try {
    const results = await reservationSyncService.retryFailedJobs();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Automated Sync (Live SkyRooms Sweeper) ───────────────────────────────────

router.post("/auto-sync/run", async (req, res) => {
  try {
    const daysAhead = req.body && req.body.daysAhead ? parseInt(req.body.daysAhead, 10) : 30;
    const isDryRun = req.body && req.body.dryRun === true;
    const result = await reconciliationService.autoSyncSkyRoomsInventory({ daysAhead, isDryRun });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/auto-sync/status", async (_req, res) => {
  try {
    const status = await reconciliationService.getStatus();
    res.json(status.autoSync || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auto-sync/blocks", async (_req, res) => {
  try {
    const blocks = await db.getSkyHmsAutoBlocks();
    res.json({ ok: true, count: blocks.length, blocks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Audit Logs ────────────────────────────────────────────────────────────────

router.get("/logs", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const level = req.query.level || null;
  const logs = auditLogger.getRecentLogs(limit, level);
  res.json(logs);
});

// ─── Availability Endpoint ─────────────────────────────────────────────────────

router.get("/availability", async (req, res) => {
  const { room, checkIn, checkOut, quantity } = req.query;
  if (!room || !checkIn || !checkOut) {
    return res.status(400).json({ error: "Missing required query parameters: room, checkIn, checkOut" });
  }

  try {
    const result = await inventorySyncService.checkAvailability({
      roomName: room,
      checkIn,
      checkOut,
      requestedRooms: Number(quantity) || 1,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Webhook Listener (Inbound from SkyHMS) ───────────────────────────────────

router.post("/webhook", async (req, res) => {
  const signature = req.headers["x-skyhms-signature"] || req.headers["x-signature"];
  const payload = req.body;

  // Verify HMAC signature if secret is configured and signature header was sent
  if (config.webhookSecret && signature) {
    try {
      const rawBody = JSON.stringify(payload);
      const expectedSig = crypto
        .createHmac("sha256", config.webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (signature !== expectedSig) {
        auditLogger.warn("WEBHOOK_SIG_MISMATCH", "Invalid SkyHMS webhook signature.", { signature });
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    } catch (sigErr) {
      return res.status(400).json({ error: "Signature verification error" });
    }
  }

  const eventId = payload.eventId || payload.event_id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const eventType = payload.eventType || payload.event_type || payload.type || "reservation_created";

  auditLogger.info("WEBHOOK_RECEIVED", `Received SkyHMS webhook [${eventType}] (Event ID: ${eventId})`, { eventId, eventType });

  try {
    const result = await reservationSyncService.handleInboundReservationEvent({
      eventId,
      eventType,
      payload: payload.data || payload.reservation || payload,
    });
    res.status(200).json(result);
  } catch (err) {
    auditLogger.error("WEBHOOK_PROCESSING_ERROR", err.message, { eventId, error: err.message });
    // Return 422 or 500 depending on unmapped vs internal
    res.status(err.message.includes("Unmapped room type") ? 422 : 500).json({
      ok: false,
      error: err.message,
      eventId,
    });
  }
});

// ─── Test Helper: Simulate Inbound SkyHMS Booking (Sandbox/Staging) ─────────────

router.post("/mock/trigger-booking", async (req, res) => {
  const { roomTypeId, checkIn, checkOut, guestName, guestPhone, guestEmail } = req.body;

  if (!roomTypeId || !checkIn || !checkOut) {
    return res.status(400).json({ error: "Missing required fields: roomTypeId, checkIn, checkOut" });
  }

  try {
    const mock = getMockAdapter();
    const externalRes = mock.simulateExternalBooking({
      roomTypeId,
      checkIn,
      checkOut,
      guestName: guestName || "OTA Booking via SkyChannels",
      guestPhone: guestPhone || "9988776655",
      guestEmail: guestEmail || "guest@ota.com",
    });

    // Ingest as an inbound event
    const eventId = `test-evt-${Date.now()}`;
    const result = await reservationSyncService.handleInboundReservationEvent({
      eventId,
      eventType: "reservation_created",
      payload: externalRes,
    });

    res.json({
      ok: true,
      message: "Simulated SkyHMS external reservation successfully created and ingested",
      reservation: externalRes,
      ingestResult: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
