/**
 * frontend/admin-sync.js
 * SkyHMS Inventory Synchronization Management Panel for Cloud Nandy Hills Admin.
 * Handles API connectivity tests, room mappings, manual reconciliations,
 * retry queue processing, discrepancy alerting, and live audit log stream.
 */

(function () {
  "use strict";

  // Base API URL
  const getApiBase = () => {
    const override = localStorage.getItem("CNH_API_OVERRIDE");
    if (override) return override.replace(/\/$/, "");

    if (
      window.location.protocol === "file:" ||
      !window.location.hostname ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return "http://localhost:3000";
    }
    return window.CLOUD_NANDY_API_URL || "https://cloudynandyhills.onrender.com";
  };

  let API_BASE = getApiBase();

  // DOM elements
  const syncTab = document.getElementById("syncTab");
  const navSyncTab = document.getElementById("navSyncTab");
  const syncPillStatus = document.getElementById("syncPillStatus");

  // Status elements
  const skyStatusBadge = document.getElementById("skyStatusBadge");
  const skyModeBadge = document.getElementById("skyModeBadge");
  const skyHotelCode = document.getElementById("skyHotelCode");
  const skyLastSync = document.getElementById("skyLastSync");
  const skySyncState = document.getElementById("skySyncState");
  const countSynced = document.getElementById("countSynced");
  const countPending = document.getElementById("countPending");
  const countFailed = document.getElementById("countFailed");
  const countMappings = document.getElementById("countMappings");
  const countAutoBlocks = document.getElementById("countAutoBlocks");

  // Automated SkyRooms Sync Elements
  const btnRunAutoSync = document.getElementById("btnRunAutoSync");
  const autoSyncDays = document.getElementById("autoSyncDays");
  const btnViewAutoBlocks = document.getElementById("btnViewAutoBlocks");
  const autoBlocksBtnCount = document.getElementById("autoBlocksBtnCount");
  const autoBlocksDrawer = document.getElementById("autoBlocksDrawer");
  const autoBlocksTbody = document.getElementById("autoBlocksTbody");
  const autoSyncLastRun = document.getElementById("autoSyncLastRun");
  const autoSyncStatus = document.getElementById("autoSyncStatus");
  const autoSyncBadge = document.getElementById("autoSyncBadge");

  // Actions
  const btnTestConn = document.getElementById("btnTestConn");
  const btnReconcileNow = document.getElementById("btnReconcileNow");
  const btnRetryFailed = document.getElementById("btnRetryFailed");
  const btnRefreshSync = document.getElementById("btnRefreshSync");
  const chkDryRun = document.getElementById("chkDryRun");
  const syncMessage = document.getElementById("syncMessage");

  // Tables
  const roomMappingsTbody = document.getElementById("roomMappingsTbody");
  const syncLogsTbody = document.getElementById("syncLogsTbody");
  const logFilterLevel = document.getElementById("logFilterLevel");
  const discrepanciesCard = document.getElementById("discrepanciesCard");
  const discrepanciesList = document.getElementById("discrepanciesList");

  // Mapping Modal / Form
  const btnNewMapping = document.getElementById("btnNewMapping");
  const mappingModalOverlay = document.getElementById("mappingModalOverlay");
  const mappingModalClose = document.getElementById("mappingModalClose");
  const mappingForm = document.getElementById("mappingForm");
  const mapPropName = document.getElementById("mapPropName");
  const mapSkyHmsId = document.getElementById("mapSkyHmsId");
  const mapRatePlan = document.getElementById("mapRatePlan");
  const mapTotalInventory = document.getElementById("mapTotalInventory");
  const mapSyncMode = document.getElementById("mapSyncMode");

  // Test simulation
  const btnSimulateBooking = document.getElementById("btnSimulateBooking");

  function showMsg(text, type = "success") {
    if (!syncMessage) return;
    syncMessage.textContent = text;
    syncMessage.className = "sync-alert-bar " + (type === "error" ? "alert-error" : "alert-success");
    syncMessage.style.display = "block";
    setTimeout(() => {
      syncMessage.style.display = "none";
    }, 5000);
  }

  // ── 1. Fetch Sync Engine Status ─────────────────────────────────────────────
  async function loadSyncStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/skyhms/status`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      if (skyStatusBadge) {
        const isLive = data.adapterMode && !data.adapterMode.toLowerCase().includes("mock");
        skyStatusBadge.textContent = isLive ? "● LIVE PMS CONNECTED" : "● MOCK / SANDBOX ACTIVE";
        skyStatusBadge.className = isLive ? "sync-badge badge-live" : "sync-badge badge-mock";
      }

      if (skyModeBadge) skyModeBadge.textContent = data.adapterMode || "Standard";
      if (skyHotelCode) skyHotelCode.textContent = data.hotelCode || "CLOUDNANDY_KODAI";
      if (skyLastSync) {
        skyLastSync.textContent = data.lastSyncTimestamp
          ? new Date(data.lastSyncTimestamp).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }) + ` (${new Date(data.lastSyncTimestamp).toLocaleDateString("en-IN")})`
          : "Not executed yet";
      }
      if (skySyncState) skySyncState.textContent = data.lastSyncStatus || "Idle";

      if (data.counts) {
        if (countSynced) countSynced.textContent = data.counts.syncedBookings ?? 0;
        if (countPending) countPending.textContent = data.counts.pendingSync ?? 0;
        if (countFailed) countFailed.textContent = data.counts.failedSync ?? 0;
        if (countMappings) countMappings.textContent = data.counts.activeMappings ?? 0;
        if (countAutoBlocks) countAutoBlocks.textContent = data.counts.activeAutoBlocks ?? 0;
        if (autoBlocksBtnCount) autoBlocksBtnCount.textContent = data.counts.activeAutoBlocks ?? 0;
      }

      if (data.autoSync) {
        if (autoSyncLastRun) {
          autoSyncLastRun.textContent = data.autoSync.lastTimestamp
            ? new Date(data.autoSync.lastTimestamp).toLocaleTimeString("en-IN") +
            ` (${new Date(data.autoSync.lastTimestamp).toLocaleDateString("en-IN")})`
            : "Never";
        }
        if (autoSyncStatus) {
          let text = data.autoSync.lastStatus || "Idle / Ready";
          if (data.autoSync.lastStats && data.autoSync.lastStats.daysScanned > 0) {
            text += ` (${data.autoSync.lastStats.daysScanned} days scanned, ${data.autoSync.lastStats.blocksCreated} new blocks, ${data.autoSync.lastStats.activeBlocksCount} active)`;
          }
          autoSyncStatus.textContent = text;
        }
        if (autoSyncBadge) {
          autoSyncBadge.textContent = data.autoSync.enabled ? "SCHEDULER RUNNING" : "PAUSED";
          autoSyncBadge.className = data.autoSync.enabled ? "sync-badge badge-synced" : "sync-badge badge-offline";
        }
      }

      if (syncPillStatus) {
        syncPillStatus.style.background =
          data.counts && data.counts.failedSync > 0 ? "#ef4444" : "#10b981";
      }
    } catch (err) {
      console.warn("Failed to load SkyHMS status:", err.message);
      if (skyStatusBadge) {
        skyStatusBadge.textContent = "● DISCONNECTED / OFFLINE";
        skyStatusBadge.className = "sync-badge badge-offline";
      }
    }
  }

  // ── 2. Test Connection ───────────────────────────────────────────────────────
  async function testConnection() {
    if (btnTestConn) {
      btnTestConn.disabled = true;
      btnTestConn.textContent = "Pinging SkyHMS…";
    }
    try {
      const res = await fetch(`${API_BASE}/api/skyhms/test-connection`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        showMsg(`✓ Connection Successful! Latency: ${data.latencyMs}ms (${data.message})`, "success");
      } else {
        showMsg(`✕ Connection Test Failed: ${data.message || data.error}`, "error");
      }
      await loadSyncStatus();
    } catch (err) {
      showMsg(`✕ Network Error: ${err.message}`, "error");
    } finally {
      if (btnTestConn) {
        btnTestConn.disabled = false;
        btnTestConn.textContent = "Test Connectivity";
      }
    }
  }

  // ── 3. Load Room Mappings ────────────────────────────────────────────────────
  async function loadRoomMappings() {
    if (!roomMappingsTbody) return;
    try {
      const res = await fetch(`${API_BASE}/api/skyhms/mappings`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const mappings = await res.json();

      if (!mappings.length) {
        roomMappingsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">No room mappings defined yet. Click "Add Room Mapping" to link a Cloudnandy cabin to SkyHMS.</td></tr>`;
        return;
      }

      roomMappingsTbody.innerHTML = mappings
        .map(
          (m) => `
        <tr>
          <td><strong style="color:#17211d;">${m.property_name}</strong></td>
          <td><code style="background:#f1f5f9;padding:3px 8px;border-radius:6px;font-weight:700;color:#0f172a;">${m.skyhms_room_type_id}</code></td>
          <td><span style="font-size:0.85rem;color:#475569;">${m.rate_plan_id || "STANDARD"}</span></td>
          <td style="text-align:center;"><strong>${m.total_inventory}</strong></td>
          <td><span class="status-pill ${m.is_active ? "badge-accepted" : "badge-rejected"}">${m.is_active ? "Active" : "Inactive"}</span></td>
          <td><small style="color:#64748b;">${m.last_verified_at ? new Date(m.last_verified_at).toLocaleDateString("en-IN") : "Pending"}</small></td>
          <td style="text-align:right;">
            <button class="btn-table-action btn-del-map" data-code="${m.skyhms_room_type_id}" style="color:#ef4444;background:none;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;">Remove</button>
          </td>
        </tr>
      `
        )
        .join("");

      // Attach remove handlers
      roomMappingsTbody.querySelectorAll(".btn-del-map").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const code = btn.dataset.code;
          if (confirm(`Remove mapping for ${code}? SkyHMS sync for this room will be paused.`)) {
            await deleteMapping(code);
          }
        });
      });
    } catch (err) {
      const is404 = err.message && err.message.includes("404");
      const hint = is404
        ? `<div style="font-size:0.82rem;color:#64748b;margin-top:8px;line-height:1.5;">
            <strong>Target API returned HTTP 404:</strong> <code>${API_BASE}/api/skyhms/mappings</code><br>
            • If you are running locally, click <strong>"Local (localhost:3000)"</strong> in the API bar above and ensure <code>node backend/server.js</code> is active.<br>
            • If using Render Cloud, the backend changes need to be git pushed and redeployed on Render.
          </div>`
        : "";
      roomMappingsTbody.innerHTML = `<tr><td colspan="7" style="color:#ef4444;padding:24px;text-align:center;">Failed to load room mappings: ${err.message}${hint}</td></tr>`;
    }
  }

  async function deleteMapping(code) {
    try {
      const res = await fetch(`${API_BASE}/api/skyhms/mappings/${code}`, { method: "DELETE" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      showMsg(`Mapping '${code}' removed.`);
      await loadRoomMappings();
      await loadSyncStatus();
    } catch (err) {
      showMsg(`Failed to delete mapping: ${err.message}`, "error");
    }
  }

  // ── 4. Trigger Reconciliation ────────────────────────────────────────────────
  async function triggerReconciliation() {
    const isDryRun = chkDryRun ? chkDryRun.checked : false;
    if (btnReconcileNow) {
      btnReconcileNow.disabled = true;
      btnReconcileNow.textContent = isDryRun ? "Simulating Reconciliation…" : "Reconciling Inventory…";
    }

    try {
      const res = await fetch(`${API_BASE}/api/skyhms/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: isDryRun }),
      });
      const data = await res.json();

      if (data.ok) {
        showMsg(
          `✓ Reconciliation Complete: ${data.discrepancies.length} discrepancies found, ${data.stats.reconciledReservations} synced.`,
          "success"
        );

        // Render discrepancies if any
        if (data.discrepancies && data.discrepancies.length > 0) {
          discrepanciesCard.style.display = "block";
          discrepanciesList.innerHTML = data.discrepancies
            .map(
              (d) => `
            <div style="padding:10px 14px;border-left:3px solid #f59e0b;background:#fffbeb;margin-bottom:8px;border-radius:0 8px 8px 0;">
              <strong style="color:#92400e;">${d.orderId} (${d.room})</strong>: ${d.message}
            </div>
          `
            )
            .join("");
        } else {
          discrepanciesCard.style.display = "none";
        }
      } else {
        showMsg(`✕ Reconciliation Error: ${data.error}`, "error");
      }

      await loadSyncStatus();
      await loadSyncLogs();
    } catch (err) {
      showMsg(`✕ Reconciliation Request Failed: ${err.message}`, "error");
    } finally {
      if (btnReconcileNow) {
        btnReconcileNow.disabled = false;
        btnReconcileNow.textContent = "Reconcile Inventory";
      }
    }
  }

  // ── 5. Retry Failed Jobs ─────────────────────────────────────────────────────
  async function retryFailedJobs() {
    if (btnRetryFailed) {
      btnRetryFailed.disabled = true;
      btnRetryFailed.textContent = "Retrying Queue…";
    }

    try {
      const res = await fetch(`${API_BASE}/api/skyhms/retry-failed`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        showMsg(
          `Retry Complete: Processed ${data.results.total} jobs (${data.results.success} recovered, ${data.results.failed} pending).`,
          "success"
        );
      } else {
        showMsg(`Retry error: ${data.error}`, "error");
      }
      await loadSyncStatus();
      await loadSyncLogs();
    } catch (err) {
      showMsg(`Retry request failed: ${err.message}`, "error");
    } finally {
      if (btnRetryFailed) {
        btnRetryFailed.disabled = false;
        btnRetryFailed.textContent = "Retry Failed Jobs";
      }
    }
  }

  // ── 6. Load Live Audit Logs ──────────────────────────────────────────────────
  async function loadSyncLogs() {
    if (!syncLogsTbody) return;
    const level = logFilterLevel ? logFilterLevel.value : "all";
    try {
      const res = await fetch(`${API_BASE}/api/skyhms/logs?limit=40&level=${level}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const logs = await res.json();

      if (!logs.length) {
        syncLogsTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#94a3b8;">No audit logs recorded yet.</td></tr>`;
        return;
      }

      syncLogsTbody.innerHTML = logs
        .map((l) => {
          const colorMap = {
            error: "#ef4444",
            warn: "#f59e0b",
            info: "#3b82f6",
            debug: "#6b7280",
          };
          const color = colorMap[l.level] || "#6b7280";
          const detailsStr = l.details ? JSON.stringify(l.details) : "";

          return `
          <tr>
            <td style="white-space:nowrap;color:#64748b;font-size:0.75rem;">
              ${new Date(l.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </td>
            <td>
              <span style="font-weight:700;color:${color};text-transform:uppercase;font-size:0.72rem;">${l.level}</span>
            </td>
            <td><code style="font-size:0.78rem;font-weight:700;color:#1e293b;">${l.action}</code></td>
            <td style="font-size:0.84rem;color:#334155;">
              ${l.message}
              ${detailsStr ? `<br><small style="color:#94a3b8;font-family:monospace;">${detailsStr.slice(0, 150)}</small>` : ""}
            </td>
          </tr>
        `;
        })
        .join("");
    } catch (err) {
      const is404 = err.message && err.message.includes("404");
      const hint = is404
        ? `<div style="font-size:0.82rem;color:#64748b;margin-top:6px;">HTTP 404 at <code>${API_BASE}/api/skyhms/logs</code>. Verify active backend target.</div>`
        : "";
      syncLogsTbody.innerHTML = `<tr><td colspan="4" style="color:#ef4444;padding:16px;">Failed to fetch logs: ${err.message}${hint}</td></tr>`;
    }
  }

  // ── 7. Simulate External SkyHMS / OTA Booking ─────────────────────────────────
  async function triggerSimulationBooking() {
    const today = new Date();
    const ci = new Date(today);
    ci.setDate(ci.getDate() + 10);
    const co = new Date(ci);
    co.setDate(co.getDate() + 2);

    const checkIn = ci.toISOString().split("T")[0];
    const checkOut = co.toISOString().split("T")[0];

    const guestName = prompt("Enter guest name for SkyHMS simulated booking:", "Vikram Travel OTA");
    if (!guestName) return;

    try {
      const res = await fetch(`${API_BASE}/api/skyhms/mock/trigger-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomTypeId: "SKY_PREM_CABIN",
          checkIn,
          checkOut,
          guestName,
          guestPhone: "9845012345",
          guestEmail: "vikram@ota.com",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showMsg(`✓ Simulated SkyHMS Booking Ingested! Order: ${data.reservation.externalReservationId}`, "success");
        await loadSyncStatus();
        await loadSyncLogs();
      } else {
        showMsg(`Simulation failed: ${data.error}`, "error");
      }
    } catch (err) {
      showMsg(`Simulation error: ${err.message}`, "error");
    }
  }

  // ── 7.5. Automated SkyRooms Sweep ───────────────────────────────────────────
  async function runAutoSyncNow() {
    if (btnRunAutoSync) {
      btnRunAutoSync.disabled = true;
      btnRunAutoSync.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="bk-spinner"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Sweeping SkyRooms (Prop 1035)…`;
    }

    const days = autoSyncDays ? parseInt(autoSyncDays.value, 10) : 30;
    const isDryRun = chkDryRun ? chkDryRun.checked : false;

    try {
      const res = await fetch(`${API_BASE}/api/skyhms/auto-sync/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysAhead: days, dryRun: isDryRun }),
      });
      const data = await res.json();

      if (data.ok) {
        const stats = data.stats || {};
        showMsg(
          `✓ Auto-Sync Completed! Scanned ${stats.daysScanned} days (${stats.roomsChecked} room checks). Placed ${stats.blocksCreated} new blocks, released ${stats.blocksReleased}. Total active blocks: ${stats.activeBlocksCount}.`,
          "success"
        );
      } else {
        showMsg(`Auto-sync error: ${data.error}`, "error");
      }

      await loadSyncStatus();
      await loadSyncLogs();
      if (autoBlocksDrawer && autoBlocksDrawer.style.display !== "none") {
        await loadAutoBlocks();
      }
    } catch (err) {
      showMsg(`Network error during auto-sync: ${err.message}`, "error");
    } finally {
      if (btnRunAutoSync) {
        btnRunAutoSync.disabled = false;
        btnRunAutoSync.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Run Auto-Sync Now`;
      }
    }
  }

  async function loadAutoBlocks() {
    if (!autoBlocksDrawer) return;

    // Toggle drawer visibility if triggered by click
    const isVisible = autoBlocksDrawer.style.display === "block";
    if (isVisible) {
      autoBlocksDrawer.style.display = "none";
      return;
    }

    autoBlocksDrawer.style.display = "block";
    if (autoBlocksTbody) {
      autoBlocksTbody.innerHTML = `<tr><td colspan="6" class="bk-loading-cell">Loading active auto-blocks…</td></tr>`;
    }

    try {
      const res = await fetch(`${API_BASE}/api/skyhms/auto-sync/blocks`);
      const data = await res.json();
      const blocks = data.blocks || [];

      if (autoBlocksBtnCount) autoBlocksBtnCount.textContent = blocks.length;
      if (countAutoBlocks) countAutoBlocks.textContent = blocks.length;

      if (!blocks.length) {
        if (autoBlocksTbody) {
          autoBlocksTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:#64748b;">No active SkyHMS blocks found. All dates are currently open.</td></tr>`;
        }
        return;
      }

      if (autoBlocksTbody) {
        autoBlocksTbody.innerHTML = blocks
          .map(
            (b) => `
          <tr>
            <td><strong>${b.room}</strong></td>
            <td><code>${b.check_in}</code></td>
            <td><code>${b.check_out}</code></td>
            <td><code style="font-size:0.78rem;color:#475569;">${b.order_id}</code></td>
            <td><span class="status-pill badge-accepted" style="background:#f3e8ff;color:#7e22ce;">Auto-Blocked</span></td>
            <td><small style="color:#64748b;">SkyRooms Live Engine</small></td>
          </tr>
        `
          )
          .join("");
      }
    } catch (err) {
      if (autoBlocksTbody) {
        autoBlocksTbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444;padding:16px;text-align:center;">Failed to load auto-blocks: ${err.message}</td></tr>`;
      }
    }
  }

  // ── 8. Form Submission for New Mapping ───────────────────────────────────────
  if (mappingForm) {
    mappingForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        property_name: mapPropName.value.trim(),
        skyhms_room_type_id: mapSkyHmsId.value.trim().toUpperCase(),
        rate_plan_id: mapRatePlan.value.trim().toUpperCase() || "STANDARD",
        total_inventory: Number(mapTotalInventory.value) || 1,
        sync_mode: mapSyncMode.value,
        is_active: true,
      };

      try {
        const res = await fetch(`${API_BASE}/api/skyhms/mappings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.ok) {
          showMsg(`✓ Mapping created for ${payload.property_name} ↔ ${payload.skyhms_room_type_id}`);
          if (mappingModalOverlay) mappingModalOverlay.style.display = "none";
          mappingForm.reset();
          await loadRoomMappings();
          await loadSyncStatus();
        } else {
          showMsg(`Failed to save mapping: ${data.error}`, "error");
        }
      } catch (err) {
        showMsg(`Error: ${err.message}`, "error");
      }
    });
  }

  // ── API Target Switcher ───────────────────────────────────────────────────
  const lblCurrentApiBase = document.getElementById("lblCurrentApiBase");
  const apiStatusPill = document.getElementById("apiStatusPill");
  const btnSwitchLocal = document.getElementById("btnSwitchLocal");
  const btnSwitchRender = document.getElementById("btnSwitchRender");
  const btnCustomApi = document.getElementById("btnCustomApi");

  function updateApiUi() {
    if (lblCurrentApiBase) lblCurrentApiBase.textContent = API_BASE;
    if (apiStatusPill) {
      if (API_BASE.includes("localhost") || API_BASE.includes("127.0.0.1")) {
        apiStatusPill.textContent = "● Localhost (Port 3000)";
        apiStatusPill.style.background = "#e0f2fe";
        apiStatusPill.style.color = "#0369a1";
      } else {
        apiStatusPill.textContent = "● Render Production";
        apiStatusPill.style.background = "#dcfce7";
        apiStatusPill.style.color = "#166534";
      }
    }
  }

  async function switchApi(newUrl) {
    API_BASE = newUrl.replace(/\/$/, "");
    localStorage.setItem("CNH_API_OVERRIDE", API_BASE);
    updateApiUi();
    showMsg(`API server changed to: ${API_BASE}. Reloading sync data...`);
    await loadSyncStatus();
    await loadRoomMappings();
    await loadSyncLogs();
  }

  if (btnSwitchLocal) {
    btnSwitchLocal.addEventListener("click", () => switchApi("http://localhost:3000"));
  }
  if (btnSwitchRender) {
    btnSwitchRender.addEventListener("click", () => switchApi("https://cloudynandyhills.onrender.com"));
  }
  if (btnCustomApi) {
    btnCustomApi.addEventListener("click", () => {
      const url = prompt("Enter custom backend API base URL (e.g. http://192.168.1.5:3000):", API_BASE);
      if (url && url.trim()) switchApi(url.trim());
    });
  }

  // Initial UI sync
  updateApiUi();

  // ── Attach Listeners ─────────────────────────────────────────────────────────
  if (btnTestConn) btnTestConn.addEventListener("click", testConnection);
  if (btnReconcileNow) btnReconcileNow.addEventListener("click", triggerReconciliation);
  if (btnRetryFailed) btnRetryFailed.addEventListener("click", retryFailedJobs);
  if (btnRunAutoSync) btnRunAutoSync.addEventListener("click", runAutoSyncNow);
  if (btnViewAutoBlocks) btnViewAutoBlocks.addEventListener("click", loadAutoBlocks);
  if (btnRefreshSync) {
    btnRefreshSync.addEventListener("click", async () => {
      await loadSyncStatus();
      await loadRoomMappings();
      await loadSyncLogs();
      showMsg("Sync dashboard refreshed.");
    });
  }
  if (logFilterLevel) logFilterLevel.addEventListener("change", loadSyncLogs);
  if (btnSimulateBooking) btnSimulateBooking.addEventListener("click", triggerSimulationBooking);

  if (btnNewMapping && mappingModalOverlay) {
    btnNewMapping.addEventListener("click", () => {
      mappingModalOverlay.style.display = "flex";
    });
  }
  if (mappingModalClose && mappingModalOverlay) {
    mappingModalClose.addEventListener("click", () => {
      mappingModalOverlay.style.display = "none";
    });
  }

  // Expose global reload function for tab switching
  window.loadAdminSyncDashboard = async function () {
    updateApiUi();
    await loadSyncStatus();
    await loadRoomMappings();
    await loadSyncLogs();
  };
})();
