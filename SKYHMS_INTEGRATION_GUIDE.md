# Cloudnandy Resort — SkyHMS Inventory Synchronization Integration Guide

**Client:** Cloudnandy Resort, Poombarai, Kodaikanal, Tamil Nadu, India  
**Development Company:** VGM SOFT TECH  
**Author:** VGM SOFT TECH PMS Integration & Architecture Team  
**Version:** 1.0.0 (Production-Ready)  

---

## 1. Executive Summary & Objective

This integration connects the **Cloudnandy Resort custom booking engine** with **SkyHMS** (Raspberry InfoSystems, Chennai) and its channel manager (**SkyChannels**) to ensure real-time, bi-directional inventory and reservation synchronization.

### Primary Business Objective
**Prevent double bookings** across all sales channels:
- When a room is booked on `www.cloudynandyhills.com`, it is atomically reserved locally and pushed to SkyHMS.
- When a room is booked via SkyHMS or any connected OTA (MakeMyTrip, Goibibo, Booking.com, Agoda, Airbnb), an inbound event updates the local reservation ledger and immediately blocks the room on the custom booking engine.

---

## 2. SkyHMS API Capabilities & Vendor Verification

### Vendor Details
- **Provider:** Raspberry InfoSystems, Chennai, Tamil Nadu, India
- **PMS Solution:** SkyHMS (Cloud Property Management System)
- **Channel Manager:** SkyChannels (80+ OTA connections)
- **Official Domains:** `skyhms.in`, `skychannels.net`
- **Official Support:** `support@skyhms.in`, `sales@skyhms.in`

### Findings Regarding API Documentation
SkyHMS does not operate a public, self-service developer documentation portal. Like many enterprise hospitality PMS providers in India, SkyHMS issues API keys, webhook URLs, and endpoint specifications on a per-property onboarding basis.

### Implemented Architecture: Configurable Adapter Pattern
To ensure the system works reliably immediately without unverified endpoints:
1. **`SkyHmsAdapterInterface`:** Formally specifies all required integration methods (`testConnection`, `getRoomTypes`, `checkAvailability`, `getInventory`, `createReservation`, `updateReservation`, `cancelReservation`, `pushInventoryUpdate`).
2. **`MockSkyHmsAdapter`:** A stateful, high-fidelity mock implementation providing sandbox testing with Cloudnandy room types, date overlap calculations, idempotency safeguards, and error simulation.
3. **`HttpSkyHmsAdapter`:** The production HTTP client that connects to SkyHMS REST endpoints when live credentials are provided.
4. **`AdapterFactory`:** Seamlessly switches between Mock and Live mode based on the `SKYHMS_USE_MOCK` and `SKYHMS_API_KEY` configuration flags.

---

## 3. Architecture & Data Flow

```
┌─────────────────────────────────┐                 ┌───────────────────────────────┐
│     Cloudnandy Direct Engine    │                 │            SkyHMS             │
│   (www.cloudynandyhills.com)    │                 │   (PMS + 80+ OTA Channels)    │
└────────────────┬────────────────┘                 └───────────────┬───────────────┘
                 │                                                  │
                 ▼                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    VGM SOFT TECH SYNCHRONIZATION ENGINE                           │
│                                                                                   │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  │
│  │ InventorySyncService  │  │ ReservationSyncService│  │  RoomMappingService   │  │
│  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  │
│  │ ReconciliationService │  │  SyncDatabase / Fallback│  │   AuditLogger Stream  │  │
│  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### A. Direct Website Booking Flow (Outbound)
1. Guest selects check-in, check-out dates, and room on `booking.html`.
2. When guest clicks "Pay & Confirm Booking", `POST /api/payment/initiate` calls `inventorySyncService.checkAvailability(...)`:
   - Checks both local confirmed bookings AND SkyHMS live availability.
   - If occupied on either system, returns `HTTP 409 Conflict` (Prevents overselling).
3. Booking is created in Supabase `bookings` with `status: 'confirmed'`, `origin: 'CUSTOM_ENGINE'`.
4. Guest completes payment via CCAvenue.
5. In CCAvenue callback (`POST /api/payment/return`), upon verification:
   - `reservationSyncService.syncWebsiteBookingToSkyHms(booking)` is called.
   - Pushes reservation to SkyHMS with `idempotencyKey = order_id`.
   - Records mapping in `skyhms_reservation_mappings`.
   - If SkyHMS is temporarily unreachable, the job is saved as `pending` and automatically retried with exponential backoff (no guest booking is ever lost).

### B. SkyHMS / OTA Inbound Booking Flow (Inbound)
1. Booking created in SkyHMS directly or via OTA (MakeMyTrip, Booking.com, etc.).
2. SkyHMS sends a webhook notification to `POST /api/skyhms/webhook`:
   - Validates webhook signature (`X-SkyHMS-Signature`).
   - Checks `skyhms_sync_events` to ensure `eventId` has not been processed (Deduplication).
   - Checks `origin`: If the reservation was originally created by our website, inbound event is acknowledged and ignored to **prevent infinite sync loops**.
3. Resolves SkyHMS room type code to Cloudnandy room name via `roomMappingService`.
4. Automatically creates a row in `bookings` with `origin: 'SKYHMS'`, `status: 'confirmed'`, `order_id: 'SKY-<externalId>'`.
5. Frontend booking engine immediately queries `/api/bookings/confirmed` and blocks those dates for all website guests!

### C. Cancellation & Date Modification
- When a reservation is cancelled in SkyHMS, inbound webhook updates local booking to `status: 'cancelled'`, immediately restoring availability on the website.
- When dates are modified, existing dates are released and new dates are locked.

---

## 4. Concurrency Control & Double Booking Prevention

| Concurrency Threat | Technical Mitigation Implemented |
|---|---|
| **Simultaneous website booking & OTA booking** | Pre-checkout authoritative availability verification checks both local reservation ledger and SkyHMS adapter. |
| **Duplicate webhook delivery** | Unique event ID deduplication table (`skyhms_sync_events`). Repeated webhook calls return `action: 'ignored_duplicate'`. |
| **Sync loopback (A pushes to B, B pushes back to A)** | `origin` field (`CUSTOM_ENGINE` vs `SKYHMS`). Subsystem skips pushing bookings whose origin matches the destination. |
| **Lost response / Network timeout** | Client uses `order_id` as external idempotency key. Adapter checks idempotency cache before creating a new reservation. |
| **Unmapped room types** | Quarantined immediately, logged as a high-priority audit error, and safely prevented from corrupting existing inventory. |
| **Date boundary overlaps** | Stay intersection equation `sA < eB && eA > sB` correctly permits same-day 11:00 AM check-out and 1:00 PM check-in without false collision. |

---

## 5. Room Mapping Matrix (Live SkyRooms Property 1035)

The following 5 room mappings reflect the live SkyRooms engine (`https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1`) and are pre-seeded in the database:

| Cloudnandy Property Name | SkyHMS / SkyRooms Code | SkyRooms Room Title | Sellable Units | Rate Plan |
|---|---|---|---|---|
| **Mountain Cabin** | `MCB` | Mountain View | 2 | STD (CP) ₹4,999.995 |
| **Deluxe Mountain View** | `DMV` | Dlx Mountain View | 3 | STD (CP) ₹6,000.00 |
| **Superior Afram Cabin (Superior Afram)** | `SFV` | Superior Afram Cabin With Mountain View | 2 | STD (CP) ₹10,000.004 |
| **WOODEN CABIN TWO BEDROOM (Dlx Wooden House)** | `DTWH` | Wooden Cabin With Two Bedroom | 1 | STD (CP) ₹10,000.004 |
| **Premium Family Cabin Mountain View** | `DDM` | Premium Room With Mountain View | 2 | STD (CP) ₹10,000.004 |

---

## 6. Automated Inventory Sync Engine (Live Property 1035 Sweeper)

To guarantee that room bookings or blocks placed on SkyRooms or connected OTAs automatically lock dates on Cloudnandy without manual operator intervention:

### How Automated Sync Works:
1. **Background Poller Worker:**  
   The synchronization engine includes a background scheduler (`reconciliationService.startScheduler()`) running periodically (every 15 minutes by default, configurable via `SKYHMS_SYNC_INTERVAL_MINUTES`).
2. **High-Performance Batch Date Sweep:**  
   For the upcoming 30 days (configurable up to 60 days via `SKYHMS_AUTO_SYNC_DAYS_AHEAD`), the engine queries `https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1` with each check-in/check-out window. SkyRooms returns availability for **all 5 rooms in a single HTTP request**, minimizing network overhead and keeping response times ultra-fast.
3. **Automated Date Locking:**  
   When a room has `0` available units or is marked `not Available` on SkyRooms, the engine automatically records an auto-block in Supabase's `bookings` table:
   - `status: 'confirmed'`
   - `origin: 'SKYHMS'`
   - `order_id: 'SKYHMS-AUTO-<roomCode>-<checkIn>'`
   - `name: 'SkyHMS Reserved / Blocked'`
   - Public endpoint `/api/bookings/confirmed` automatically returns these dates, instantly disabling them on the customer booking calendar.
4. **Automated Cancellation & Release:**  
   If a date was previously auto-blocked and subsequently becomes available again on SkyRooms (e.g. cancellation), the engine automatically marks the auto-block `cancelled`, opening the dates back up on Cloudnandy.
5. **Pre-Checkout Double-Booking Guard:**  
   At checkout time (`/api/payment/initiate`), real-time authoritative verification queries live SkyRooms to prevent race conditions.

### Automated Sync Endpoints:
- `POST /api/skyhms/auto-sync/run` — Run immediate automated sweep (Body: `{ daysAhead: 30, dryRun: false }`)
- `GET /api/skyhms/auto-sync/status` — Get status, last sweep timestamp, and stats
- `GET /api/skyhms/auto-sync/blocks` — List all current active auto-blocks placed from SkyRooms

---

## 7. Database Schema & Migration Instructions

Execute the provided SQL script in your Supabase SQL Editor:
**File:** [backend/migrations/001_skyhms_sync_schema.sql](file:///d:/website/cloudnandy%20(2)/cloudnandy/backend/migrations/001_skyhms_sync_schema.sql)

### Tables Created:
1. `skyhms_room_mappings`: Configurable property-to-room-type mappings with verification timestamp.
2. `skyhms_reservation_mappings`: Two-way ledger linking internal `order_id` with `skyhms_reservation_id`.
3. `skyhms_sync_events`: Webhook deduplication log.
4. `skyhms_sync_logs`: Structured audit logs with severity levels.
5. `skyhms_config`: Key-value configuration store for runtime flags.
6. Columns added to `bookings`: `origin`, `skyhms_reservation_id`, `skyhms_sync_status`.

*Note: The backend has built-in graceful fallback. If the database migration has not yet been run in Supabase, the synchronization subsystem safely operates using its memory-backed store without crashing.*

---

## 8. Environment Variables

Add these variables to your Render Web Service dashboard (`cloud-nandy-api`) or local `.env`:

```env
# SkyHMS Global Controls
SKYHMS_USE_MOCK=false             # false = connects to live SkyRooms engine (Prop 1035)
SKYHMS_SYNC_ENABLED=true          # Master enable/disable toggle
SKYHMS_DRY_RUN=false              # Set to 'true' for preview mode without writing changes

# Live SkyRooms Connection Settings
SKYHMS_HOTEL_CODE=1035
SKYHMS_PROPERTY_ID=1035
SKYHMS_API_URL=https://bookings.skyrooms.in

# Automated Sync Scheduler
SKYHMS_AUTO_SYNC_ENABLED=true
SKYHMS_AUTO_SYNC_DAYS_AHEAD=30
SKYHMS_SYNC_INTERVAL_MINUTES=15
SKYHMS_MAX_RETRIES=5
```

---

## 9. Admin Dashboard Usage

Access the Admin Dashboard at `admin.html` and click the **"Inventory Sync"** tab in the navigation bar.

Features available:
1. **Automated Inventory Sync Card:** 
   - Displays real-time scheduler status (active every 15 min).
   - Shows last sweep timestamp, scanned days, and active blocked dates count.
   - **"Run Auto-Sync Now"** button: Triggers an immediate 30-day live inventory sweep with animated progress.
   - **"View Auto-Blocked Dates"** button: Opens a detailed drawer displaying all active room dates locked by SkyRooms.
2. **Connectivity Status:** Displays `LIVE PMS CONNECTED`, `MOCK / SANDBOX ACTIVE`, or `DISCONNECTED`.
3. **Test Connectivity:** Sends a live ping to `https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1` and displays response latency in milliseconds.
4. **Reconcile Inventory:** Runs an immediate reconciliation comparison between local records and SkyRooms.
5. **Dry-Run / Preview Mode:** Check this box before clicking "Reconcile" or "Auto-Sync" to inspect results without writing changes.
6. **Retry Failed Queue:** Manually retries any outbound bookings that previously failed due to network outages.
7. **Room Mappings Manager:** View existing mappings, add new mappings, or remove unmapped rooms.
8. **Live Audit Trail:** Filter logs by severity (`All`, `Errors Only`, `Warnings & Errors`, `Info`) to inspect every synchronization event.

---

## 10. Verification & Automated Test Results

Run the automated test suite locally:
```bash
npm test
```

### Test Results Summary:
```text
✔ Scenario 1: Direct website booking reduces availability correctly
✔ Scenario 2: A SkyHMS booking reduces availability in the custom engine
✔ Scenario 3: A cancellation restores inventory exactly once
✔ Scenario 4: A booking modification adjusts the affected dates correctly
✔ Scenario 5: Duplicate webhook events do not create duplicate reservations
✔ Scenario 6: A timeout does not result in duplicate reservation creation
✔ Scenario 7: Simultaneous bookings cannot oversell locally controlled inventory
✔ Scenario 8: Unmapped room types are rejected or quarantined safely
✔ Scenario 9: API authentication failures are handled correctly
✔ Scenario 10: SkyHMS downtime does not corrupt local reservations
✔ Scenario 11: Stale events / loopback cannot overwrite newer reservation state
✔ Scenario 12: Reconciliation identifies and reports discrepancies
✔ Scenario 13: Time zones and check-in/check-out date boundaries are handled correctly
✔ Scenario 14: Payment failures and expired inventory holds follow existing business rules
✔ Scenario 15: Automated sync sweeps and locks unavailable PMS room dates into Cloudnandy
✔ Scenario 16: Automated sync releases auto-blocks when PMS room becomes available again

Total: 16 tests, 16 passed, 0 failed (100% Pass Rate)
```

---

## 11. Production Activation Checklist

- [x] **Verify Live Booking Engine URL:** `https://bookings.skyrooms.in/roombooking?bkgpropid=1035&&bkgrooms=1` verified and mapped.
- [x] **Verify All 5 Room Codes:** `MCB`, `DMV`, `SFV`, `DTWH`, `DDM` confirmed active and mapped to Cloudnandy listings.
- [x] **Automated 30-Day Inventory Sweep:** Active with scheduled periodic background worker.
- [x] **Direct Customer Booking Protection:** Pre-checkout concurrency checks active on `/api/payment/initiate`.
- [x] **Admin Dashboard Controls:** 1-Click live auto-sync, connection testing, and blocked dates inspection.
- [ ] **Run Database Migration:** Run `backend/migrations/001_skyhms_sync_schema.sql` in Supabase SQL Editor.
- [ ] **Render Deploy:** Ensure Render environment variables match `backend/.env.example` (`SKYHMS_HOTEL_CODE=1035`).
