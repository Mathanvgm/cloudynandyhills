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

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchBookings() {
    if (!db) { showMessage("Supabase not connected.", "error"); return []; }
    const { data, error } = await db
      .from("bookings")
      .select("*")
      .order("booked_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderBookings(bookings) {
    if (!bookingsTbody) return;

    if (!bookings || bookings.length === 0) {
      bookingsTbody.innerHTML =
        '<tr><td colspan="9" style="text-align:center;padding:56px 24px;">' +
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
      const isPending     = currentStatus === "pending";
      const bg            = isPending ? rowBgPending : rowBg;

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

      // Status badge
      const badgeMap = {
        confirmed: { label: "Confirmed",  bg: "#dcfce7", color: "#15803d" },
        pending:   { label: "Pending",    bg: "#fff7ed", color: "#c2410c" },
        cancelled: { label: "Cancelled",  bg: "#fee2e2", color: "#b91c1c" },
        failed:    { label: "Failed",     bg: "#fee2e2", color: "#b91c1c" },
        completed: { label: "Completed",  bg: "#f0f9ff", color: "#0369a1" },
      };
      const badge = badgeMap[currentStatus] || badgeMap.pending;
      const badgeHtml =
        '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:0.72rem;font-weight:700;background:' + badge.bg + ';color:' + badge.color + ';white-space:nowrap;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;display:inline-block;"></span>' +
        badge.label + '</span>';

      // Action buttons
      const viewBtn =
        '<button class="bk-view-btn" data-id="' + esc(b.id) + '"' +
        ' style="display:inline-flex;align-items:center;gap:5px;padding:7px 13px;background:#f1f5f9;color:#17211d;border:1px solid #e2e8f0;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
        'View</button>';

      let actionHtml = "";
      if (isPending) {
        actionHtml =
          viewBtn +
          '<button class="bk-accept-btn" data-id="' + esc(b.id) + '" data-status="confirmed"' +
          ' style="display:inline-flex;align-items:center;padding:7px 14px;background:#10b981;color:#fff;border:none;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;margin-right:6px;white-space:nowrap;">✓ Confirm</button>' +
          '<button class="bk-reject-btn" data-id="' + esc(b.id) + '" data-status="cancelled"' +
          ' style="display:inline-flex;align-items:center;padding:7px 14px;background:#fff;color:#ef4444;border:1px solid #fca5a5;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">✕ Reject</button>';
      } else if (currentStatus === "confirmed") {
        actionHtml = viewBtn + '<span style="font-size:0.78rem;font-weight:700;color:#15803d;white-space:nowrap;">✓ Confirmed</span>';
      } else {
        actionHtml = viewBtn + '<span style="font-size:0.78rem;font-weight:700;color:#b91c1c;white-space:nowrap;">✕ ' +
          (currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)) + '</span>';
      }

      const tdStyle = 'style="padding:14px 16px;vertical-align:middle;' + borderStyle + 'background:' + bg + ';white-space:nowrap;"';

      return (
        '<tr>' +
        // Name + avatar
        '<td ' + tdStyle + '>' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#b45f3c,#9a4f32);color:#fff;font-size:0.78rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;text-transform:uppercase;">' + esc(initials) + '</div>' +
            '<span style="font-weight:700;color:#1e293b;font-size:0.875rem;">' + esc(b.name) + '</span>' +
          '</div>' +
        '</td>' +
        // Phone
        '<td ' + tdStyle + '><span style="font-size:0.875rem;color:#475569;">' + esc(b.phone) + '</span></td>' +
        // Email
        '<td ' + tdStyle + '><span style="font-size:0.82rem;color:#475569;">' + esc(b.email) + '</span></td>' +
        // Room
        '<td style="padding:14px 16px;vertical-align:middle;' + borderStyle + 'background:' + bg + ';max-width:180px;white-space:normal;"><span style="font-weight:600;color:#1e293b;font-size:0.875rem;">' + esc(b.room) + '</span></td>' +
        // Dates
        '<td ' + tdStyle + '><span style="font-size:0.82rem;color:#475569;">' + fmtD(b.check_in) + ' → ' + fmtD(b.check_out) + '</span></td>' +
        // Amount
        '<td ' + tdStyle + '><span style="font-weight:700;color:#1e293b;font-size:0.875rem;">' + formatCurrency(b.total_amount) + '</span></td>' +
        // Booked at
        '<td ' + tdStyle + '>' +
          '<div style="display:flex;flex-direction:column;gap:1px;">' +
            '<span style="font-weight:600;color:#1e293b;font-size:0.82rem;">' + bookedDate + '</span>' +
            '<span style="font-size:0.75rem;color:#94a3b8;">' + bookedTime + '</span>' +
          '</div>' +
        '</td>' +
        // Status
        '<td ' + tdStyle + '>' + badgeHtml + '</td>' +
        // Actions
        '<td ' + tdStyle + '>' +
          '<div style="display:flex;align-items:center;gap:6px;">' + actionHtml + '</div>' +
        '</td>' +
        '</tr>'
      );
    }).join("");

    // Attach View handlers
    bookingsTbody.querySelectorAll(".bk-view-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const booking = allBookings.find(function (b) { return String(b.id) === String(btn.dataset.id); });
        if (booking) openBookingModal(booking);
      });
    });

    // Attach Confirm / Reject handlers
    bookingsTbody.querySelectorAll(".bk-accept-btn, .bk-reject-btn").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        await updateBookingStatus(btn.dataset.id, btn.dataset.status);
      });
    });
  }

  // ── Update status ─────────────────────────────────────────────────────────
  async function updateBookingStatus(id, status) {
    if (!db) return;
    try {
      const { error } = await db.from("bookings").update({ status: status }).eq("id", id);
      if (error) throw new Error(error.message);
      const b = allBookings.find(function (x) { return x.id === id; });
      if (b) b.status = status;
      applyFilters();
      showMessage(
        status === "confirmed" ? "Booking confirmed ✓" : "Booking rejected.",
        status === "confirmed" ? "success" : "error"
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
      const matchStatus = !status || (b.status || "pending") === status;
      return matchQ && matchStatus;
    });

    renderBookings(filtered);
  }

  // ── Update nav badge & overview counter ───────────────────────────────────
  function updateNavBadge() {
    const pendingCount = allBookings.filter(function (b) { return b.status === "pending"; }).length;

    const overviewEl = document.getElementById("totalBookingsOverview");
    if (overviewEl) overviewEl.textContent = String(allBookings.length);

    const navBtn = document.getElementById("navBookingTab");
    if (navBtn) {
      const existing = navBtn.querySelector(".nav-pending-badge");
      if (existing) existing.remove();
      if (pendingCount > 0) {
        const badge = document.createElement("span");
        badge.className = "nav-pending-badge";
        badge.textContent = pendingCount;
        badge.style.cssText =
          "background:#e74c3c;color:#fff;border-radius:50%;font-size:0.65rem;font-weight:700;" +
          "padding:1px 6px;margin-left:6px;vertical-align:middle;display:inline-block;min-width:18px;text-align:center;";
        navBtn.appendChild(badge);
      }
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async function loadBookings() {
    if (!bookingsTbody) return;
    bookingsTbody.innerHTML =
      '<tr><td colspan="9" class="bookings-loading">Loading bookings…</td></tr>';
    try {
      allBookings = await fetchBookings();
      updateNavBadge();
      applyFilters();
    } catch (err) {
      bookingsTbody.innerHTML =
        '<tr><td colspan="9" class="bookings-empty" style="color:#b45f3c;">Error: ' +
        esc(err.message) + "</td></tr>";
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  if (refreshBookingsBtn) refreshBookingsBtn.addEventListener("click", loadBookings);
  if (bookingsSearch)     bookingsSearch.addEventListener("input", applyFilters);
  if (bookingsStatusFilter) bookingsStatusFilter.addEventListener("change", applyFilters);

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

    const html =
      // Status banner
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:' + s.bg + ';border-radius:10px;margin-bottom:22px;">' +
        '<span style="font-size:0.8rem;font-weight:700;color:' + s.color + ';">Status</span>' +
        '<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;font-weight:800;color:' + s.color + ';">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + s.color + ';display:inline-block;"></span>' +
          s.label +
        '</span>' +
      '</div>' +

      // Guest details section
      '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Guest Information</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">' +
        field("Full Name", b.name) +
        field("Phone", b.phone) +
        field("Email", b.email) +
        field("Guests", b.guests || b.num_guests || "—") +
      '</div>' +

      // Booking details section
      '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Booking Information</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">' +
        field("Room / Property", b.room) +
        field("Amount Paid", formatCurrency(b.total_amount)) +
        field("Check-In", fmtD(b.check_in)) +
        field("Check-Out", fmtD(b.check_out)) +
        field("Booked At", bookedAt) +
        field("Booking ID", b.id) +
      '</div>' +

      // Special requests
      (b.special_requests || b.notes || b.message
        ? '<p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#b45f3c;">Special Requests</p>' +
          '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:0.88rem;color:#475569;line-height:1.6;">' +
          esc(b.special_requests || b.notes || b.message) + '</div>'
        : '');

    if (modalBody) modalBody.innerHTML = html;
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
    if (b.guests || b.num_guests) row("Guests", b.guests || b.num_guests, true);
    y += 10;

    // ── Booking Information ──
    sectionTitle("Booking Information");
    row("Room / Property", b.room,                         false);
    row("Check-In",        fmtD(b.check_in),               true);
    row("Check-Out",       fmtD(b.check_out),              false);
    row("Total Amount",    formatCurrency(b.total_amount), true);
    y += 10;

    // ── Special requests ──
    if (b.special_requests || b.notes || b.message) {
      sectionTitle("Special Requests");
      const text = safe(b.special_requests || b.notes || b.message);
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
