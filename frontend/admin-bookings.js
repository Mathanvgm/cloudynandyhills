// ── admin-bookings.js — Cloud Nandy Admin Bookings Panel ─────────────────────
(function () {
  "use strict";

  const db = window.supabaseClient;

  const bookingsTbody      = document.getElementById("bookingsTbody");
  const bookingsCount      = document.getElementById("bookingsCount");
  const bookingsMessage    = document.getElementById("bookingsMessage");
  const refreshBookingsBtn = document.getElementById("refreshBookings");
  const bookingsSearch     = document.getElementById("bookingsSearch");
  const bookingsStatusFilter = document.getElementById("bookingsStatusFilter");

  let allBookings = [];

  // ── Helpers ───────────────────────────────────────────────────────────────
  const esc = (v) =>
    String(v || "—").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])
    );

  const formatCurrency = (val) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  };

  const fmtDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };

  const fmtTime = (d) => {
    if (!d) return "";
    return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  const statusBadge = (status) => {
    const map = {
      confirmed: { label: "Confirmed",  cls: "badge-accepted" },
      pending:   { label: "Pending",    cls: "badge-pending-new" },
      cancelled: { label: "Cancelled",  cls: "badge-rejected" },
      failed:    { label: "Failed",     cls: "badge-rejected" },
      completed: { label: "Completed",  cls: "badge-delivered" },
    };
    const s = map[status] || map.pending;
    return '<span class="status-pill ' + s.cls + '">' + s.label + '</span>';
  };

  // ── Fetch — confirmed / cancelled / completed + stuck pending (>15 min) ──
  async function fetchBookings() {
    if (!db) { showMessage("Supabase not connected.", "error"); return []; }

    // Fetch the main set: confirmed, cancelled, completed
    const { data: mainData, error: mainErr } = await db
      .from("bookings")
      .select("*")
      .in("status", ["confirmed", "cancelled", "completed"])
      .order("booked_at", { ascending: false });
    if (mainErr) throw new Error(mainErr.message);

    // Also fetch "stuck" pending bookings (>15 min old — CCAvenue return likely failed)
    // These appear with a yellow "Stuck" label so admin can manually confirm/cancel
    const cutoffTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: stuckData } = await db
      .from("bookings")
      .select("*")
      .eq("status", "pending")
      .lt("booked_at", cutoffTime)
      .order("booked_at", { ascending: false });

    // Tag stuck records so they render differently
    const tagged = (stuckData || []).map(function (b) {
      return Object.assign({}, b, { _stuck: true });
    });

    return [...(mainData || []), ...tagged];
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderBookings(bookings) {
    if (!bookingsTbody) return;

    if (!bookings || bookings.length === 0) {
      bookingsTbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:56px 24px;">' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:#94a3b8;">' +
        '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;">' +
        '<path d="M8 7V3m8 4V3M3 11h18M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>' +
        '<p style="margin:0;font-size:1rem;font-weight:700;color:#17211d;">No bookings yet</p>' +
        '<small style="font-size:0.85rem;">Bookings from the website will appear here automatically.</small>' +
        '</div></td></tr>';
      if (bookingsCount) bookingsCount.textContent = "0";
      return;
    }

    if (bookingsCount) bookingsCount.textContent = String(bookings.length);

    // Row background colours
    const rowBg       = "#ffffff";
    const rowBgPending = "#fffbf5";
    const borderStyle = "border-bottom:1px solid #f1f5f9;";

    bookingsTbody.innerHTML = bookings.map(function (b) {
      const currentStatus = b.status || "pending";
      const isStuck       = !!b._stuck; // pending > 15min — CCAvenue return likely failed
      const bg            = isStuck ? "#fffbeb" : (currentStatus === "pending" ? "#fffbf5" : "#ffffff");

      // Avatar initials
      const initials = (b.name || "?")
        .split(" ").map(function (w) { return w[0] || ""; })
        .join("").substring(0, 2).toUpperCase();

      // Booked-at date/time
      const dateObj    = b.booked_at ? new Date(b.booked_at) : new Date();
      const bookedDate = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const bookedTime = dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

      // Check-in / check-out
      const fmtD = function (d) {
        if (!d) return "—";
        return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      };

      // Status badge — stuck records show ⚠ Payment Pending in amber
      const badgeMap = {
        confirmed: { label: "Confirmed",  bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
        pending:   { label: "Pending",    bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
        cancelled: { label: "Cancelled",  bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
        failed:    { label: "Failed",     bg: "#fef2f2", color: "#991b1b", border: "#fecdd3" },
        completed: { label: "Completed",  bg: "#f0f9ff", color: "#0284c7", border: "#bae6fd" },
      };
      const badge = isStuck
        ? { label: "⚠ Payment Issue", bg: "#fef9c3", color: "#854d0e", border: "#fef08a" }
        : (badgeMap[currentStatus] || badgeMap.pending);
      const badgeHtml =
        '<span style="display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;font-size:0.72rem;font-weight:700;background:' + badge.bg + ';color:' + badge.color + ';border:1px solid ' + badge.border + ';white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.03);">' +
        badge.label + '</span>';


      // 3-dot Action button (no status shown in actions column!)
      const dotsBtn =
        '<button class="bk-dots-btn" data-id="' + esc(b.id) + '" type="button" aria-label="Booking actions" title="Actions"' +
        ' style="width:34px;height:34px;border-radius:8px;border:1px solid #e2e8f0;background:#ffffff;color:#475569;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s ease;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
          '<circle cx="12" cy="5" r="1.8"/>' +
          '<circle cx="12" cy="12" r="1.8"/>' +
          '<circle cx="12" cy="19" r="1.8"/>' +
        '</svg>' +
        '</button>';

      const tdStyle = 'style="padding:14px 16px;vertical-align:middle;' + borderStyle + 'background:' + bg + ';white-space:nowrap;"';

      const nightsCount = (b.check_in && b.check_out)
        ? Math.max(Math.round((new Date(b.check_out + "T00:00:00") - new Date(b.check_in + "T00:00:00")) / 86400000), 1)
        : 1;

      const guestsStr = (b.adults ? (b.adults + " Adult" + (b.adults > 1 ? "s" : "")) : "") +
        (b.children ? (", " + b.children + " Child" + (b.children > 1 ? "ren" : "")) : "") ||
        b.guests || b.num_guests || "1 Adult";

      return (
        '<tr class="bk-booking-row" data-id="' + esc(b.id) + '" style="cursor:pointer;">' +
        // 1. Guest Name + avatar + email
        '<td style="padding:14px 16px;vertical-align:middle;' + borderStyle + 'background:' + bg + ';min-width:190px;max-width:240px;white-space:normal;">' +
          '<div style="display:flex;align-items:center;gap:11px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#b45f3c,#9a4f32);color:#fff;font-size:0.76rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;text-transform:uppercase;box-shadow:0 2px 5px rgba(180,95,60,0.22);">' + esc(initials) + '</div>' +
            '<div>' +
              '<span style="font-weight:700;color:#0f172a;font-size:0.88rem;line-height:1.35;word-break:normal;overflow-wrap:normal;display:block;">' + esc(b.name) + '</span>' +
              (b.email ? '<span style="font-size:0.75rem;color:#64748b;display:block;margin-top:2px;">' + esc(b.email) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</td>' +
        // 2. Status
        '<td ' + tdStyle + '>' + badgeHtml + '</td>' +
        // 3. Room & Guests
        '<td style="padding:14px 16px;vertical-align:middle;' + borderStyle + 'background:' + bg + ';min-width:170px;max-width:220px;white-space:normal;line-height:1.35;">' +
          '<span style="font-weight:700;color:#1e293b;font-size:0.85rem;display:block;">' + esc(b.room) + '</span>' +
          '<span style="font-size:0.75rem;color:#64748b;display:block;margin-top:2px;">' + esc(guestsStr) + '</span>' +
        '</td>' +
        // 4. Dates & Duration (Up and down)
        '<td ' + tdStyle + '>' +
          '<div style="display:flex;flex-direction:column;gap:3px;white-space:nowrap;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="font-size:0.62rem;font-weight:800;padding:2px 5px;border-radius:4px;background:#e2e8f0;color:#475569;letter-spacing:0.03em;">IN</span>' +
              '<span style="font-size:0.82rem;font-weight:700;color:#0f172a;">' + fmtD(b.check_in) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="font-size:0.62rem;font-weight:800;padding:2px 5px;border-radius:4px;background:#fef3c7;color:#92400e;letter-spacing:0.03em;">OUT</span>' +
              '<span style="font-size:0.82rem;font-weight:700;color:#64748b;">' + fmtD(b.check_out) + '</span>' +
            '</div>' +
            '<div style="margin-top:2px;">' +
              '<span style="font-size:0.68rem;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:1px 6px;border-radius:4px;display:inline-block;">' +
                nightsCount + (nightsCount === 1 ? ' Night' : ' Nights') +
              '</span>' +
            '</div>' +
          '</div>' +
        '</td>' +
        // 5. Amount
        '<td ' + tdStyle + '><span style="font-weight:800;color:#0f172a;font-size:0.92rem;font-variant-numeric:tabular-nums;">' + formatCurrency(b.total_amount) + '</span></td>' +
        // 6. Phone
        '<td ' + tdStyle + '><span style="font-size:0.84rem;font-weight:600;color:#475569;">' + esc(b.phone) + '</span></td>' +
        // 7. Booked at
        '<td ' + tdStyle + '>' +
          '<div style="display:flex;flex-direction:column;gap:1px;">' +
            '<span style="font-weight:600;color:#1e293b;font-size:0.82rem;">' + bookedDate + '</span>' +
            '<span style="font-size:0.74rem;color:#94a3b8;">' + bookedTime + '</span>' +
          '</div>' +
        '</td>' +
        // 8. Actions (3-dot button)
        '<td style="padding:14px 16px;vertical-align:middle;text-align:center;width:70px;' + borderStyle + 'background:' + bg + ';">' +
          dotsBtn +
        '</td>' +
        '</tr>'
      );
    }).join("");

    // Attach 3-dot menu handlers
    bookingsTbody.querySelectorAll(".bk-dots-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const booking = allBookings.find(function (b) { return String(b.id) === String(btn.dataset.id); });
        if (booking) toggleActionMenu(btn, booking);
      });
    });

    // Row click to open full details modal
    bookingsTbody.querySelectorAll(".bk-booking-row").forEach(function (tr) {
      tr.addEventListener("click", function (e) {
        if (e.target.closest(".bk-dots-btn") || e.target.closest("#bkActionDropdown")) return;
        const booking = allBookings.find(function (b) { return String(b.id) === String(tr.dataset.id); });
        if (booking) openBookingModal(booking);
      });
    });
  }

  // ── Floating 3-Dot Action Dropdown Menu ──────────────────────────────────
  let actionDropdownEl = document.getElementById("bkActionDropdown");
  if (!actionDropdownEl) {
    actionDropdownEl = document.createElement("div");
    actionDropdownEl.id = "bkActionDropdown";
    actionDropdownEl.style.cssText =
      "display:none;position:fixed;z-index:99999;background:#ffffff;border:1px solid #e2e8f0;" +
      "border-radius:10px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.15),0 6px 12px -3px rgba(0,0,0,0.08);" +
      "min-width:148px;padding:6px;font-family:inherit;";
    document.body.appendChild(actionDropdownEl);
  }

  function closeActionMenu() {
    if (actionDropdownEl) {
      actionDropdownEl.style.display = "none";
      actionDropdownEl._currentBtn = null;
    }
  }

  function toggleActionMenu(btn, booking) {
    if (actionDropdownEl && actionDropdownEl.style.display === "block" && actionDropdownEl._currentBtn === btn) {
      closeActionMenu();
      return;
    }

    actionDropdownEl._currentBtn = btn;

    // Only show Cancel when booking is currently confirmed
    const isConfirmed = booking.status === "confirmed";
    const isStuck     = !!booking._stuck;

    actionDropdownEl.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:2px;">' +
        // View
        '<button type="button" class="bk-menu-item view" data-action="view" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 12px;border:none;background:transparent;color:#1e293b;font-size:0.82rem;font-weight:600;border-radius:6px;cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
          '<span>View</span>' +
        '</button>' +
        // Mark Confirmed — only for stuck pending records (payment return failed)
        (isStuck
          ? '<button type="button" class="bk-menu-item mark-confirmed" data-action="mark-confirmed" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 12px;border:none;background:transparent;color:#047857;font-size:0.82rem;font-weight:600;border-radius:6px;cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#047857" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
              '<span>Mark Confirmed</span>' +
            '</button>' +
            '<button type="button" class="bk-menu-item discard" data-action="discard" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 12px;border:none;background:transparent;color:#ef4444;font-size:0.82rem;font-weight:600;border-radius:6px;cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '<span>Discard (Cancel)</span>' +
            '</button>'
          : '') +
        // Cancel — only shown when booking is confirmed
        (isConfirmed
          ? '<button type="button" class="bk-menu-item cancel" data-action="cancel" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 12px;border:none;background:transparent;color:#ef4444;font-size:0.82rem;font-weight:600;border-radius:6px;cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '<span>Cancel Booking</span>' +
            '</button>'
          : '') +
      '</div>';

    // Hover state styling
    actionDropdownEl.querySelectorAll(".bk-menu-item").forEach(function(item) {
      item.addEventListener("mouseenter", function() {
        if (item.classList.contains("cancel") || item.classList.contains("discard")) item.style.background = "#fef2f2";
        else if (item.classList.contains("mark-confirmed")) item.style.background = "#ecfdf5";
        else item.style.background = "#f1f5f9";
      });
      item.addEventListener("mouseleave", function() {
        item.style.background = "transparent";
      });
    });

    // Event listeners
    const viewItem          = actionDropdownEl.querySelector('[data-action="view"]');
    const cancelItem        = actionDropdownEl.querySelector('[data-action="cancel"]');
    const markConfirmedItem = actionDropdownEl.querySelector('[data-action="mark-confirmed"]');
    const discardItem       = actionDropdownEl.querySelector('[data-action="discard"]');

    if (viewItem) {
      viewItem.addEventListener("click", function() {
        closeActionMenu();
        openBookingModal(booking);
      });
    }
    if (cancelItem) {
      cancelItem.addEventListener("click", async function() {
        closeActionMenu();
        const confirmed = window.confirm(
          "Cancel this booking for " + (booking.name || "guest") + "?\n" +
          "Room: " + (booking.room || "—") + "\n" +
          "This will release the room for new bookings."
        );
        if (confirmed) await updateBookingStatus(booking.id, "cancelled");
      });
    }
    if (markConfirmedItem) {
      markConfirmedItem.addEventListener("click", async function() {
        closeActionMenu();
        const ok = window.confirm(
          "Mark this booking as Confirmed for " + (booking.name || "guest") + "?\n" +
          "Room: " + (booking.room || "—") + "\n\n" +
          "Use this only if the customer's payment was successful but the redirect failed."
        );
        if (ok) await updateBookingStatus(booking.id, "confirmed");
      });
    }
    if (discardItem) {
      discardItem.addEventListener("click", async function() {
        closeActionMenu();
        const ok = window.confirm(
          "Discard this stuck booking for " + (booking.name || "guest") + "?\n" +
          "This will mark it as Cancelled."
        );
        if (ok) await updateBookingStatus(booking.id, "cancelled");
      });
    }

    // Position menu
    actionDropdownEl.style.display = "block";
    const rect = btn.getBoundingClientRect();
    const menuWidth = 168;
    let leftPos = rect.right - menuWidth;
    if (leftPos < 10) leftPos = 10;
    let topPos = rect.bottom + 6;

    if (topPos + 160 > window.innerHeight) {
      topPos = rect.top - 165;
    }

    actionDropdownEl.style.top = topPos + "px";
    actionDropdownEl.style.left = leftPos + "px";
  }

  // Close menu on clicks outside or scroll or Escape
  document.addEventListener("click", function(e) {
    if (!e.target.closest(".bk-dots-btn") && !e.target.closest("#bkActionDropdown")) {
      closeActionMenu();
    }
  });
  window.addEventListener("scroll", closeActionMenu, true);
  window.addEventListener("resize", closeActionMenu);
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeActionMenu();
  });

  // ── Update status ─────────────────────────────────────────────────────────
  async function updateBookingStatus(id, status) {
    if (!db) return;
    try {
      const { error } = await db.from("bookings").update({ status: status }).eq("id", id);
      if (error) throw new Error(error.message);
      // Remove cancelled bookings from the local list (they'll still show via realtime if needed)
      if (status === "cancelled") {
        const b = allBookings.find(function (x) { return String(x.id) === String(id); });
        if (b) b.status = "cancelled";
      } else {
        const b = allBookings.find(function (x) { return String(x.id) === String(id); });
        if (b) b.status = status;
      }
      updateNavBadge();
      applyFilters();
      showMessage(
        status === "completed" ? "Booking marked as Completed ✓" : (status === "cancelled" ? "Booking cancelled — room is now available." : "Booking updated."),
        status === "completed" ? "success" : "error"
      );
    } catch (err) {
      showMessage("Update failed: " + err.message, "error");
    }
  }

  // ── Message bar ───────────────────────────────────────────────────────────
  function showMessage(text, type) {
    if (!bookingsMessage) return;
    bookingsMessage.textContent = text;
    bookingsMessage.className = "bookings-msg " + (type === "error" ? "error" : "success");
    bookingsMessage.hidden = false;
    setTimeout(function () { bookingsMessage.hidden = true; }, 4000);
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  function applyFilters() {
    const q      = bookingsSearch ? bookingsSearch.value.toLowerCase() : "";
    const status = bookingsStatusFilter ? bookingsStatusFilter.value : "";

    const filtered = allBookings.filter(function (b) {
      const matchQ =
        !q ||
        (b.name  || "").toLowerCase().includes(q) ||
        (b.email || "").toLowerCase().includes(q) ||
        (b.phone || "").includes(q) ||
        (b.room  || "").toLowerCase().includes(q);
      const bStatus = b.status || "pending";
      const matchStatus = !status || bStatus === status;
      return matchQ && matchStatus;
    });

    renderBookings(filtered);
  }

  // ── Update nav badge, overview counter & status tabs ──────────────────────
  function updateNavBadge() {
    const totalCount     = allBookings.length;
    const confirmedCount = allBookings.filter(function (b) { return b.status === "confirmed"; }).length;
    const cancelledCount = allBookings.filter(function (b) { return b.status === "cancelled"; }).length;
    const completedCount = allBookings.filter(function (b) { return b.status === "completed"; }).length;

    const overviewEl = document.getElementById("totalBookingsOverview");
    if (overviewEl) overviewEl.textContent = String(totalCount);

    const countAllEl       = document.getElementById("countAll");
    const countConfirmedEl = document.getElementById("countConfirmed");
    const countCancelledEl = document.getElementById("countCancelled");
    const countCompletedEl = document.getElementById("countCompleted");

    if (countAllEl)       countAllEl.textContent = String(totalCount);
    if (countConfirmedEl) countConfirmedEl.textContent = String(confirmedCount);
    if (countCancelledEl) countCancelledEl.textContent = String(cancelledCount);
    if (countCompletedEl) countCompletedEl.textContent = String(completedCount);

    // Nav badge shows confirmed (paid, active) booking count
    const navBtn = document.getElementById("navBookingTab");
    if (navBtn) {
      const existing = navBtn.querySelector(".nav-pending-badge");
      if (existing) existing.remove();
      if (confirmedCount > 0) {
        const badge = document.createElement("span");
        badge.className = "nav-pending-badge";
        badge.textContent = confirmedCount;
        badge.style.cssText =
          "background:#10b981;color:#fff;border-radius:50%;font-size:0.65rem;font-weight:700;" +
          "padding:1px 6px;margin-left:6px;vertical-align:middle;display:inline-block;min-width:18px;text-align:center;";
        navBtn.appendChild(badge);
      }
    }
  }

  // ── Status Chips Filter Synchronization ───────────────────────────────────
  function syncStatusChips(selectedStatus) {
    const chips = document.querySelectorAll(".status-chip");
    chips.forEach(function (chip) {
      const chipStatus = chip.getAttribute("data-status") || "";
      const isActive = chipStatus === selectedStatus;
      chip.classList.toggle("active", isActive);
      if (isActive) {
        chip.style.background = "#17211d";
        chip.style.color = "#ffffff";
        chip.style.borderColor = "#17211d";
      } else {
        const colorMap = {
          "":          { bg: "#ffffff", text: "#475569", border: "#e2e8f0" },
          "confirmed": { bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" },
          "cancelled": { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
          "completed": { bg: "#f0f9ff", text: "#0284c7", border: "#bae6fd" },
        };
        const c = colorMap[chipStatus] || colorMap[""];
        chip.style.background = c.bg;
        chip.style.color = c.text;
        chip.style.borderColor = c.border;
      }
    });
  }

  document.querySelectorAll(".status-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      const s = chip.getAttribute("data-status") || "";
      if (bookingsStatusFilter) bookingsStatusFilter.value = s;
      syncStatusChips(s);
      applyFilters();
    });
  });

  // ── Load ──────────────────────────────────────────────────────────────────
  async function loadBookings() {
    if (!bookingsTbody) return;
    bookingsTbody.innerHTML =
      '<tr><td colspan="8" class="bookings-loading">Loading bookings…</td></tr>';
    try {
      allBookings = await fetchBookings();
      updateNavBadge();
      applyFilters();
    } catch (err) {
      bookingsTbody.innerHTML =
        '<tr><td colspan="8" class="bookings-empty" style="color:#b45f3c;">Error: ' +
        esc(err.message) + "</td></tr>";
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  if (refreshBookingsBtn) refreshBookingsBtn.addEventListener("click", loadBookings);
  if (bookingsSearch)     bookingsSearch.addEventListener("input", applyFilters);
  if (bookingsStatusFilter) {
    bookingsStatusFilter.addEventListener("change", function () {
      syncStatusChips(bookingsStatusFilter.value);
      applyFilters();
    });
  }

  // ── Supabase Realtime — new bookings appear instantly ─────────────────────
  (function setupRealtime() {
    if (!db) return;
    try {
      db.channel("bookings-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "bookings" },
          function (payload) {
            if (payload.eventType === "INSERT") {
              allBookings.unshift(payload.new);
            } else if (payload.eventType === "UPDATE") {
              const idx = allBookings.findIndex(function (b) { return b.id === payload.new.id; });
              if (idx > -1) allBookings[idx] = payload.new;
              else allBookings.unshift(payload.new);
            } else if (payload.eventType === "DELETE") {
              allBookings = allBookings.filter(function (b) { return b.id !== payload.old.id; });
            }
            updateNavBadge();
            applyFilters();
          }
        )
        .subscribe();
    } catch (err) {
      console.warn("Realtime setup failed:", err.message);
    }
  })();

  window.loadAdminBookings = loadBookings;

  // ── Booking Detail Modal ──────────────────────────────────────────────────
  const overlay       = document.getElementById("bookingDetailOverlay");
  const modalTitle    = document.getElementById("bdmTitle");
  const modalBody     = document.getElementById("bookingDetailBody");
  const closeBtn      = document.getElementById("bookingDetailClose");
  const closeBtn2     = document.getElementById("bookingDetailCloseBtn");
  const downloadBtn   = document.getElementById("bookingDetailDownload");

  function openBookingModal(b) {
    if (!overlay) return;

    const statusMap = {
      confirmed: { label: "Confirmed", color: "#15803d", bg: "#dcfce7" },
      pending:   { label: "Pending",   color: "#c2410c", bg: "#fff7ed" },
      cancelled: { label: "Cancelled", color: "#b91c1c", bg: "#fee2e2" },
      failed:    { label: "Failed",    color: "#b91c1c", bg: "#fee2e2" },
      completed: { label: "Completed", color: "#0369a1", bg: "#f0f9ff" },
    };
    const s = statusMap[b.status || "pending"] || statusMap.pending;

    const fmtD = function (d) {
      if (!d) return "—";
      return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    };

    const bookedAt = b.booked_at
      ? new Date(b.booked_at).toLocaleString("en-IN", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

    if (modalTitle) modalTitle.textContent = "Booking #" + String(b.id).substring(0, 8).toUpperCase();

    const field = function (label, value) {
      return (
        '<div style="display:flex;flex-direction:column;gap:3px;">' +
          '<span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#94a3b8;">' + label + '</span>' +
          '<span style="font-size:0.95rem;font-weight:600;color:#1e293b;">' + esc(value || "—") + '</span>' +
        '</div>'
      );
    };

    const nights = (b.check_in && b.check_out)
      ? Math.max(Math.round((new Date(b.check_out + "T00:00:00") - new Date(b.check_in + "T00:00:00")) / 86400000), 1)
      : 1;

    const guestsDisplay = (b.adults ? b.adults + " Adult" + (b.adults > 1 ? "s" : "") : "") +
      (b.children ? (", " + b.children + " Child" + (b.children > 1 ? "ren" : "")) : "") ||
      b.guests || b.num_guests || "1 Adult";

    const specialReqs = b.requests || b.special_requests || b.notes || b.message || "";

    const html =
      // Status banner — read-only (no inline changer in modal)
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:' + s.bg + ';border-radius:10px;margin-bottom:22px;flex-wrap:wrap;gap:12px;">' +
        '<div>' +
          '<span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:' + s.color + ';display:block;">Booking Status</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.95rem;font-weight:800;color:' + s.color + ';margin-top:2px;">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + s.color + ';display:inline-block;"></span>' +
            s.label +
          '</span>' +
        '</div>' +
        (b.status === "confirmed"
          ? '<button id="bdmCancelBtn" style="padding:7px 16px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit;">Cancel Booking</button>'
          : '') +
      '</div>' +

      // Guest details section
      '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Guest Information</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">' +
        field("Full Name", b.name) +
        field("Phone", b.phone) +
        field("Email", b.email) +
        field("Guests", guestsDisplay) +
      '</div>' +

      // Booking details section
      '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Booking Information</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">' +
        field("Room / Property", b.room) +
        field("Amount Paid", formatCurrency(b.total_amount)) +
        field("Check-In", fmtD(b.check_in)) +
        field("Check-Out", fmtD(b.check_out)) +
        field("Duration", nights + (nights === 1 ? " Night" : " Nights")) +
        field("Booked At", bookedAt) +
        field("Order ID", b.order_id || "—") +
        field("Booking ID", b.id) +
      '</div>' +

      // Special requests
      '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Special Requests</p>' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:0.88rem;color:' + (specialReqs ? '#1e293b' : '#94a3b8') + ';line-height:1.6;margin-bottom:12px;">' +
        esc(specialReqs || "None provided.") +
      '</div>';

    if (modalBody) modalBody.innerHTML = html;

    // Cancel button inside modal (only present when status is confirmed)
    const modalCancelBtn = document.getElementById("bdmCancelBtn");
    if (modalCancelBtn) {
      modalCancelBtn.addEventListener("click", async function () {
        const ok = window.confirm(
          "Cancel this booking for " + (b.name || "guest") + "?\n" +
          "Room: " + (b.room || "—") + "\n" +
          "This will release the room for new bookings on the website."
        );
        if (!ok) return;
        modalCancelBtn.disabled = true;
        modalCancelBtn.textContent = "Cancelling…";
        await updateBookingStatus(b.id, "cancelled");
        b.status = "cancelled";
        closeBookingModal();
      });
    }

    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";

    // Store current booking for PDF
    overlay._currentBooking = b;
  }

  function closeBookingModal() {
    if (!overlay) return;
    overlay.style.display = "none";
    document.body.style.overflow = "";
  }

  function downloadBookingPDF() {
    const b = overlay && overlay._currentBooking;
    if (!b) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const W = doc.internal.pageSize.getWidth();
    const margin = 48;
    const contentW = W - margin * 2;
    let y = margin;

    const fmtD = function (d) {
      if (!d) return "—";
      return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    };
    const bookedAt = b.booked_at
      ? new Date(b.booked_at).toLocaleString("en-IN", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
    const statusLabel = (b.status || "pending").charAt(0).toUpperCase() + (b.status || "pending").slice(1);
    const safe = function (v) { return String(v || "—"); };

    // ── Header bar ──
    doc.setFillColor(23, 33, 29);
    doc.rect(0, 0, W, 60, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text("Cloud Nandy Hills", margin, 36);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 200, 190);
    doc.text("Booking Confirmation", margin, 50);
    y = 80;

    // ── Booking ID + Booked At (top right) ──
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("Booking ID", W - margin, 22, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(String(b.id).toUpperCase(), W - margin, 34, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(180, 200, 190);
    doc.text("Booked: " + bookedAt, W - margin, 46, { align: "right" });

    // ── Status pill ──
    const statusColors = {
      confirmed: [21, 128, 61],
      pending:   [194, 65, 12],
      cancelled: [185, 28, 28],
      failed:    [185, 28, 28],
      completed: [3, 105, 161],
    };
    const sc = statusColors[b.status || "pending"] || statusColors.pending;
    doc.setFillColor(sc[0], sc[1], sc[2]);
    doc.roundedRect(margin, y, 90, 22, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(statusLabel, margin + 45, y + 14.5, { align: "center" });
    y += 38;

    // ── Section helper ──
    function sectionTitle(title) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(180, 95, 60);
      doc.text(title.toUpperCase(), margin, y);
      y += 4;
      doc.setDrawColor(180, 95, 60);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentW, y);
      y += 14;
    }

    // ── Row helper ──
    function row(label, value, shade) {
      if (shade) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 11, contentW, 20, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(label, margin + 6, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(safe(value), margin + contentW * 0.45, y);
      y += 22;
    }

    // ── Guest Information ──
    sectionTitle("Guest Information");
    row("Full Name",  b.name,  false);
    row("Phone",      b.phone, true);
    row("Email",      b.email, false);
    const gVal = (b.adults ? b.adults + " Adult" + (b.adults > 1 ? "s" : "") : "") +
      (b.children ? ", " + b.children + " Child" + (b.children > 1 ? "ren" : "") : "") ||
      b.guests || b.num_guests || "1 Adult";
    row("Guests", gVal, true);
    y += 10;

    // ── Booking Information ──
    const nights = (b.check_in && b.check_out)
      ? Math.max(Math.round((new Date(b.check_out + "T00:00:00") - new Date(b.check_in + "T00:00:00")) / 86400000), 1)
      : 1;

    sectionTitle("Booking Information");
    row("Room / Property", b.room,                         false);
    row("Check-In",        fmtD(b.check_in),               true);
    row("Check-Out",       fmtD(b.check_out),              false);
    row("Duration",        nights + (nights === 1 ? " Night" : " Nights"), true);
    row("Total Amount",    formatCurrency(b.total_amount), false);
    if (b.order_id) row("Order ID", b.order_id,            true);
    y += 10;

    // ── Special requests ──
    const reqText = b.requests || b.special_requests || b.notes || b.message;
    if (reqText) {
      sectionTitle("Special Requests");
      const text = safe(reqText);
      const lines = doc.splitTextToSize(text, contentW - 12);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 11, contentW, lines.length * 14 + 16, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(lines, margin + 6, y);
      y += lines.length * 14 + 20;
    }

    // ── Footer ──
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 40, W - margin, pageH - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Thank you for choosing Cloud Nandy Hills. For queries, contact us directly.", W / 2, pageH - 26, { align: "center" });

    const filename = "CloudNandy_Booking_" + String(b.id).substring(0, 8).toUpperCase() + ".pdf";
    doc.save(filename);
  }

  if (closeBtn)    closeBtn.addEventListener("click", closeBookingModal);
  if (closeBtn2)   closeBtn2.addEventListener("click", closeBookingModal);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadBookingPDF);

  // Close on overlay click (outside modal)
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeBookingModal();
    });
  }

  // Expose for row handlers
  window.openBookingModal = openBookingModal;

})();
