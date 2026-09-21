/**
 * booking2.js — Luxury Reservation Engine for Cloud Nandy Hills
 * Handles availability filtering, dynamic rate computation, interactive guest
 * configuration, sticky reservation sidebar, gallery auto-scroll, and payment checkout.
 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const toVal = (d) => d.toISOString().split("T")[0];
  const addDay = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const fmtRaw = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const esc = (v) =>
    String(v || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        }[c])
    );

  // ── Date Defaults & URL Parameters ──────────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const ci = $("checkIn");
  const co = $("checkOut");
  const rc = $("roomsCount");

  const paramGuests = urlParams.get("guests");
  if (paramGuests && rc) {
    rc.value = paramGuests;
  }
  let selectedRoomFilter = urlParams.get("room") || null;

  const updateNightsBadge = () => {
    if (!ci || !co) return 1;
    const s = new Date(ci.value + "T00:00:00");
    const e = new Date(co.value + "T00:00:00");
    const count = Math.max(Math.round((e - s) / 86400000), 1);
    const badge = $("bkNightsCount");
    if (badge) {
      badge.textContent = `${count} ${count === 1 ? "Night" : "Nights"}`;
    }
    return count;
  };

  if (ci) {
    ci.min = toVal(today);
    ci.value = urlParams.get("checkIn") || toVal(addDay(today, 1));
    ci.addEventListener("change", () => {
      const s = new Date(ci.value + "T00:00:00");
      co.min = toVal(addDay(s, 1));
      if (new Date(co.value + "T00:00:00") <= s) co.value = toVal(addDay(s, 1));
      updateNightsBadge();
      fetchConfirmedBookings().then(() => renderRooms());
      renderSidebar();
    });
  }
  if (co) {
    co.min = toVal(addDay(today, 2));
    co.value = urlParams.get("checkOut") || toVal(addDay(today, 2));
    co.addEventListener("change", () => {
      updateNightsBadge();
      fetchConfirmedBookings().then(() => renderRooms());
      renderSidebar();
    });
  }

  const nights = () => updateNightsBadge();

  // Initial badge calculation
  updateNightsBadge();

  // ── State ────────────────────────────────────────────────────────────────────
  let allRooms = [];
  let rooms = [];
  let cart = null; // { id, name, incRate, adults, children, extra }
  let activeFilter = "all";
  let activeSort = "default";
  let confirmedBookings = [];
  let galleryTimers = [];

  // ── Supabase Setup ───────────────────────────────────────────────────────────
  function getDb() {
    if (window.supabaseClient) return window.supabaseClient;
    const cfg = window.CLOUD_NANDY_SUPABASE || window.SUPABASE_CONFIG || {};
    const url = cfg.url || "https://wyjkehxbybkakgxdnoje.supabase.co";
    const key = cfg.key || cfg.anonKey || "sb_publishable_FmN54Y2I0thkiRcGsoZWzg_VSfI6Dia";
    if (window.supabase) {
      window.supabaseClient = window.supabase.createClient(url, key);
      return window.supabaseClient;
    }
    return null;
  }

  const API_BASE = "https://cloudynandyhills.onrender.com";

  async function fetchConfirmedBookings() {
    try {
      const res = await fetch(API_BASE + "/api/bookings/confirmed");
      if (!res.ok) throw new Error("HTTP " + res.status);
      confirmedBookings = await res.json();
    } catch {
      confirmedBookings = [];
    }
  }

  function isRoomBlockedForDates(roomName, inVal, outVal) {
    if (!inVal || !outVal) return false;
    const selIn = new Date(inVal + "T00:00:00");
    const selOut = new Date(outVal + "T00:00:00");
    if (isNaN(selIn) || isNaN(selOut) || selOut <= selIn) return false;
    return confirmedBookings.some((b) => {
      if ((b.room || "").trim().toLowerCase() !== (roomName || "").trim().toLowerCase()) return false;
      const bIn = new Date(b.check_in + "T00:00:00");
      const bOut = new Date(b.check_out + "T00:00:00");
      return bIn < selOut && bOut > selIn;
    });
  }

  function isRoomBlocked(roomName) {
    const inVal = ci ? ci.value : "";
    const outVal = co ? co.value : "";
    return isRoomBlockedForDates(roomName, inVal, outVal);
  }

  // ── Gallery Auto-Scroll & Controls ───────────────────────────────────────────
  function initBookingGalleries() {
    galleryTimers.forEach(id => {
      clearInterval(id);
      clearTimeout(id);
    });
    galleryTimers = [];

    document.querySelectorAll(".bk-card-gallery").forEach((gallery, gIdx) => {
      const track = gallery.querySelector(".bk-card-gallery-track");
      const slides = gallery.querySelectorAll(".bk-card-slide");
      if (!track || slides.length <= 1) return;

      const prevBtn = gallery.querySelector(".bk-gallery-nav-btn.prev");
      const nextBtn = gallery.querySelector(".bk-gallery-nav-btn.next");
      const counter = gallery.querySelector(".curr-img-idx");

      let currentIdx = 0;
      let isHovered = false;
      let timer = null;

      const goTo = (targetIdx) => {
        currentIdx = (targetIdx + slides.length) % slides.length;
        track.style.transform = `translateX(-${currentIdx * 100}%)`;
        if (counter) counter.textContent = currentIdx + 1;
      };

      const start = () => {
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
          if (!isHovered) goTo(currentIdx + 1);
        }, 3600);
        galleryTimers.push(timer);
      };

      gallery.addEventListener("mouseenter", () => { isHovered = true; });
      gallery.addEventListener("mouseleave", () => { isHovered = false; });

      if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          goTo(currentIdx - 1);
          start();
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          goTo(currentIdx + 1);
          start();
        });
      }

      // Stagger start
      const initDelay = 1200 + (gIdx * 600);
      const to = setTimeout(start, initDelay);
      galleryTimers.push(to);
    });
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  function renderSidebar() {
    const sidebar = document.getElementById("bkSidebar");
    const body = document.getElementById("bkSidebarBody");
    if (!sidebar || !body) return;

    if (!cart) {
      body.innerHTML = `
        <div style="text-align:center;padding:36px 12px;color:var(--text-muted);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;color:var(--text-gold);opacity:0.8;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <p style="font-size:0.95rem;font-weight:700;color:#fff;margin-bottom:6px;">No Stay Selected</p>
          <p style="font-size:0.8rem;line-height:1.5;">Choose a mountain cabin on the left to configure guests and view reservation breakdown.</p>
        </div>
      `;
      return;
    }

    const n = nights();
    const fmtD = (v) => v.split("-").reverse().join("-");
    const cinDisplay = fmtD(ci.value);
    const coutDisplay = fmtD(co.value);

    const incRate = cart.incRate;
    const excRate = incRate / 1.05;
    const extraChildInc = Math.round(incRate * 0.2);
    const extraChildExc = extraChildInc / 1.05;
    const extraChildCostExc = extraChildExc * cart.children;

    const roomRentExc = (excRate + extraChildCostExc) * n;
    const tax = roomRentExc * 0.05;
    const exact = roomRentExc + tax;
    const total = Math.round(exact);
    const diff = total - exact;
    const roundStr = (diff >= 0 ? "+ " : "- ") + "₹" + Math.abs(diff).toFixed(2);

    body.innerHTML = `
      <div class="bk-sb-room-name">${esc(cart.name)}</div>
      <div class="bk-sb-room-desc">Scenic Mountain View &bull; Breakfast (CP) Included</div>

      <div class="bk-sb-dates-box">
        <div class="bk-sb-dates-col">
          <strong>Dates &bull; Check-In / Out</strong>
          <span>${cinDisplay} &rarr; ${coutDisplay}</span>
        </div>
        <div class="bk-sb-nights-badge">${n} ${n === 1 ? "Night" : "Nights"}</div>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-glass);padding:10px 14px;border-radius:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;">
        <span style="color:var(--text-gold);font-weight:600;">Selected Guests</span>
        <span style="font-weight:700;color:#fff;">${cart.adults} Adult${cart.adults > 1 ? "s" : ""}${cart.children > 0 ? ", " + cart.children + " Child" : ""}</span>
      </div>

      <div class="bk-sb-breakdown">
        <div class="bk-sb-row bold">
          <span>Cabin Rent (${n}N)</span>
          <span>₹${fmtRaw(excRate * n)}</span>
        </div>
        ${
          cart.children > 0
            ? `
          <div class="bk-sb-row">
            <span>Extra Child (${cart.children})</span>
            <span>₹${fmtRaw(extraChildCostExc * n)}</span>
          </div>
        `
            : ""
        }
        <div class="bk-sb-row">
          <span>GST / Taxes (5%)</span>
          <span>₹${fmtRaw(tax)}</span>
        </div>
        <div class="bk-sb-row">
          <span>Round-off</span>
          <span>${roundStr}</span>
        </div>
      </div>

      <div class="bk-sb-total-box">
        <span class="bk-sb-total-lbl">Total Payable</span>
        <span class="bk-sb-total-val">₹${Number(total).toLocaleString("en-IN")}.00</span>
      </div>

      <button type="button" class="bk-sb-action-btn" id="bkSbReserve">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>RESERVE NOW</span>
      </button>

      <div class="bk-sb-perks">
        <div class="bk-sb-perk-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Instant booking confirmation</span>
        </div>
        <div class="bk-sb-perk-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Complimentary hill breakfast included</span>
        </div>
        <div class="bk-sb-perk-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Free cancellation up to 48 hours</span>
        </div>
      </div>
    `;

    const reserveBtn = document.getElementById("bkSbReserve");
    if (reserveBtn) {
      reserveBtn.addEventListener("click", openCheckout);
    }
  }

  // ── Fetch Rooms ──────────────────────────────────────────────────────────────
  async function fetchRooms() {
    const db = getDb();
    if (!db) throw new Error("Database not configured.");
    const tableName = (window.CLOUD_NANDY_SUPABASE && window.CLOUD_NANDY_SUPABASE.table) || "properties";
    const { data, error } = await db
      .from(tableName)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price || 0),
      description: p.description || "",
      images: p.image_urls && p.image_urls.length ? p.image_urls : [p.image_url || p.image].filter(Boolean),
    }));
  }

  // ── Render Rooms ─────────────────────────────────────────────────────────────
  function renderRooms() {
    const list = $("bkRoomList");
    if (!list) return;

    if (!rooms.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:80px 20px;background:var(--bg-card);border:1px solid var(--border-glass);border-radius:var(--radius-lg);">
          <p style="font-size:1.2rem;font-weight:700;color:#fff;margin-bottom:8px;">No Cabins Available</p>
          <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:20px;">No stays matched your dates or filter criteria.</p>
          <button type="button" class="bk-btn-update" id="bkResetFiltersBtn">Reset &amp; View All Stays</button>
        </div>
      `;
      const rst = $("bkResetFiltersBtn");
      if (rst) {
        rst.addEventListener("click", () => {
          selectedRoomFilter = null;
          activeFilter = "all";
          applyFilterAndSort();
        });
      }
      return;
    }

    const defaultAdults = paramGuests && Number(paramGuests) >= 1 && Number(paramGuests) <= 5 ? Number(paramGuests) : 2;

    list.innerHTML = rooms
      .map((r, i) => {
        const inCart = cart && cart.id === r.id;
        const blocked = isRoomBlocked(r.name);
        const incRate = r.price;

        const imgs = r.images.length ? r.images : ["./image.jpg"];
        const hasMulti = imgs.length > 1;

        const imgsJSON = esc(JSON.stringify(imgs));
        const adultVal = inCart ? cart.adults : defaultAdults;
        const childVal = inCart ? cart.children : 0;
        const extraVal = inCart ? cart.extra : 0;

        return `
        <article class="bk-room-card" id="card-${esc(r.id)}">
          <!-- Room Gallery Carousel -->
          <div class="bk-card-gallery" data-gallery-id="${i}">
            <div class="bk-card-gallery-track">
              ${imgs
                .map(
                  (url, idx) => `
                <div class="bk-card-slide">
                  <a href="#" class="lightbox-trigger" data-images="${imgsJSON}" data-index="${idx}" aria-label="View photo ${idx + 1}">
                    <img src="${esc(url)}" alt="${esc(r.name)} - Photo ${idx + 1}" loading="${idx === 0 ? "eager" : "lazy"}" />
                  </a>
                </div>
              `
                )
                .join("")}
            </div>
            <div class="bk-card-gallery-overlay"></div>
            ${
              hasMulti
                ? `
              <button class="bk-gallery-nav-btn prev" type="button" aria-label="Previous image">&#10094;</button>
              <button class="bk-gallery-nav-btn next" type="button" aria-label="Next image">&#10095;</button>
              <div class="bk-gallery-counter">
                <span class="curr-img-idx">1</span> / ${imgs.length}
              </div>
            `
                : ""
            }
          </div>

          <!-- Room Information -->
          <div class="bk-room-body">
            <div class="bk-room-header">
              <div class="bk-room-title">
                <h3>${esc(r.name)}</h3>
                <div class="bk-room-tags">
                  <span class="bk-room-tag">Mountain View</span>
                  <span class="bk-room-tag">Free Breakfast (CP)</span>
                  <span class="bk-room-tag">Max 5 Guests</span>
                  ${
                    blocked
                      ? `<span style="background:rgba(239,68,68,0.2);color:#fca5a5;border:1px solid rgba(239,68,68,0.4);font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:20px;">Unavailable For Dates</span>`
                      : ""
                  }
                </div>
              </div>

              <div class="bk-price-tag">
                <div class="bk-price-amount">₹${Number(incRate).toLocaleString("en-IN")}</div>
                <div class="bk-price-sub">per night (inclusive of GST)</div>
              </div>
            </div>

            <p class="bk-room-desc">
              ${esc(
                r.description ||
                  "Enjoy scenic panoramic mountain views, misty pine breeze, plush wooden interior, and serene hill stay hospitality."
              )}
            </p>

            <!-- Key Amenities Grid -->
            <div class="bk-amenities-section-title">Included Cabin Amenities</div>
            <div class="bk-amenities-grid">
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>
                <span>Smart Android TV</span>
              </div>
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                <span>Advanced Room Heater</span>
              </div>
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"></path></svg>
                <span>King Size Bed</span>
              </div>
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
                <span>Mountain Spring Water</span>
              </div>
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>
                <span>Fresh Breakfast Included</span>
              </div>
              <div class="bk-amenity-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span>Plush Towels &amp; Linens</span>
              </div>
            </div>

            <!-- Modern Guest Configuration Selectors -->
            <div class="bk-config-box" id="cfg-${esc(r.id)}">
              <div class="bk-config-header">
                <span class="bk-config-title">Configure Guests for this Stay</span>
                <span class="bk-config-note">Accommodates up to 5 guests</span>
              </div>

              <div class="bk-config-selectors">
                <div class="bk-selector-group">
                  <label>Adults (12+ yrs)</label>
                  <select class="bk-stepper-select" data-role="adults" data-rid="${esc(r.id)}">
                    <option value="1" ${adultVal === 1 ? "selected" : ""}>1 Adult</option>
                    <option value="2" ${adultVal === 2 ? "selected" : ""}>2 Adults</option>
                    <option value="3" ${adultVal === 3 ? "selected" : ""}>3 Adults</option>
                    <option value="4" ${adultVal === 4 ? "selected" : ""}>4 Adults</option>
                    <option value="5" ${adultVal === 5 ? "selected" : ""}>5 Adults</option>
                  </select>
                </div>

                <div class="bk-selector-group">
                  <label>Children (under 12 yrs)</label>
                  <select class="bk-stepper-select" data-role="children" data-rid="${esc(r.id)}">
                    <option value="0" ${childVal === 0 ? "selected" : ""}>0 Children</option>
                    <option value="1" ${childVal === 1 ? "selected" : ""}>1 Child</option>
                    <option value="2" ${childVal === 2 ? "selected" : ""}>2 Children</option>
                  </select>
                </div>

                <div class="bk-selector-group">
                  <label>Extra Bed / Mattress</label>
                  <select class="bk-stepper-select" data-role="extra" data-rid="${esc(r.id)}">
                    <option value="0" ${extraVal === 0 ? "selected" : ""}>None</option>
                    <option value="1" ${extraVal === 1 ? "selected" : ""}>1 Extra Bed</option>
                    <option value="2" ${extraVal === 2 ? "selected" : ""}>2 Extra Beds</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Card Footer Action -->
            <div class="bk-card-footer">
              <div class="bk-card-guarantee">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                <span>Free cancellation up to 48 hours before check-in</span>
              </div>

              ${
                blocked
                  ? `
                <button class="bk-btn-reserve" disabled type="button">
                  <span>Dates Unavailable</span>
                </button>
              `
                  : `
                <button class="bk-btn-reserve" data-rid="${esc(r.id)}" type="button">
                  <span>Reserve This Cabin</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              `
              }
            </div>
          </div>
        </article>
      `;
      })
      .join("");

    // Initialize photo gallery carousels on room cards
    initBookingGalleries();

    // Hook Reserve button click handlers
    list.querySelectorAll(".bk-btn-reserve").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rid = btn.dataset.rid;
        const room = rooms.find((r) => r.id === rid);
        if (!room || isRoomBlocked(room.name)) return;
        const cfg_box = document.getElementById("cfg-" + rid);
        cart = {
          id: rid,
          name: room.name,
          incRate: room.price,
          adults: Number(cfg_box ? cfg_box.querySelector('[data-role="adults"]').value : defaultAdults),
          children: Number(cfg_box ? cfg_box.querySelector('[data-role="children"]').value : 0),
          extra: parseInt(cfg_box ? cfg_box.querySelector('[data-role="extra"]').value : 0, 10),
        };
        renderRooms();
        renderSidebar();
        openCheckout();
      });
    });

    // Hook config changes
    list.querySelectorAll(".bk-stepper-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const rid = sel.dataset.rid;
        if (cart && cart.id === rid) {
          const cfg_box = document.getElementById("cfg-" + cart.id);
          cart.adults = parseInt(cfg_box.querySelector('[data-role="adults"]').value, 10);
          cart.children = parseInt(cfg_box.querySelector('[data-role="children"]').value, 10);
          cart.extra = parseInt(cfg_box.querySelector('[data-role="extra"]').value, 10);
          renderSidebar();
        }
      });
    });
  }

  // ── Filter & Sort Logic ───────────────────────────────────────────────────────
  function applyFilterAndSort() {
    let filtered = [...allRooms];

    // If user arrived by clicking "Book" on a specific room, ONLY show that room
    if (selectedRoomFilter) {
      const match = filtered.filter((r) => {
        const a = (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const b = selectedRoomFilter.toLowerCase().replace(/[^a-z0-9]/g, "");
        return a.includes(b) || b.includes(a);
      });
      if (match.length > 0) {
        filtered = match;
      }
    } else {
      // Category filters
      if (activeFilter === "cabin") {
        filtered = filtered.filter((r) => {
          const text = `${r.name} ${r.description || ""}`.toLowerCase();
          return text.includes("cabin") || text.includes("wooden") || text.includes("house");
        });
      } else if (activeFilter === "mountain") {
        filtered = filtered.filter((r) => {
          const text = `${r.name} ${r.description || ""}`.toLowerCase();
          return text.includes("mountain") || text.includes("view") || text.includes("afram") || text.includes("superior");
        });
      } else if (activeFilter === "family") {
        filtered = filtered.filter((r) => {
          const text = `${r.name} ${r.description || ""}`.toLowerCase();
          return text.includes("family") || text.includes("bedroom") || text.includes("two") || text.includes("dlx");
        });
      }
    }

    // Sort
    if (activeSort === "price-asc") {
      filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (activeSort === "price-desc") {
      filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (activeSort === "name-asc") {
      filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    rooms = filtered;

    const countEl = $("bkResultsCount");
    const pillsWrap = $("bkFilterPills");

    if (selectedRoomFilter && rooms.length === 1) {
      if (pillsWrap) pillsWrap.style.display = "none";
      if (countEl) {
        countEl.innerHTML = `
          <span style="display:inline-flex;align-items:center;gap:10px;">
            <strong style="color:var(--text-gold);font-size:0.85rem;">Selected Stay: ${esc(rooms[0].name)}</strong>
            <button type="button" id="bkShowAllStaysBtn" style="background:rgba(255,255,255,0.08);border:1px solid var(--border-glass);padding:4px 12px;border-radius:14px;color:var(--accent);font-weight:700;font-size:0.75rem;cursor:pointer;">&larr; View All Stays</button>
          </span>
        `;
        const showAll = $("bkShowAllStaysBtn");
        if (showAll) {
          showAll.addEventListener("click", () => {
            selectedRoomFilter = null;
            if (pillsWrap) pillsWrap.style.display = "flex";
            applyFilterAndSort();
          });
        }
      }
    } else {
      if (pillsWrap) pillsWrap.style.display = "flex";
      if (countEl) {
        countEl.textContent = `${rooms.length} ${rooms.length === 1 ? "Stay" : "Stays"}`;
      }
    }

    renderRooms();
  }

  function initFilterAndSortControls() {
    const pills = document.querySelectorAll("#bkFilterPills .bk-pill");
    pills.forEach((p) => {
      if (p.dataset.filter === activeFilter) {
        pills.forEach((x) => x.classList.remove("active"));
        p.classList.add("active");
      }
      p.addEventListener("click", () => {
        pills.forEach((x) => x.classList.remove("active"));
        p.classList.add("active");
        activeFilter = p.dataset.filter || "all";
        applyFilterAndSort();
      });
    });

    const sortSel = $("bkSortSelect");
    if (sortSel) {
      sortSel.value = activeSort;
      sortSel.addEventListener("change", () => {
        activeSort = sortSel.value;
        applyFilterAndSort();
      });
    }
  }

  function showAvailAlert(type, htmlMsg) {
    const alertBox = $("bkAvailAlert");
    const msgEl = $("bkAvailAlertMsg");
    if (!alertBox || !msgEl) return;

    alertBox.className = `bk-avail-alert ${type}`;
    msgEl.innerHTML = htmlMsg;
    alertBox.style.display = "block";
  }

  // ── Availability Check Button Handler ─────────────────────────────────────────
  const checkBtn = $("checkAvailBtn");
  if (checkBtn) {
    checkBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const sVal = ci ? ci.value : "";
      const eVal = co ? co.value : "";

      if (!sVal || !eVal) {
        showAvailAlert("error", "Please select both check-in and check-out dates.");
        return;
      }

      const s = new Date(sVal + "T00:00:00");
      const end = new Date(eVal + "T00:00:00");
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      if (s < now) {
        showAvailAlert("error", "Check-in date cannot be in the past.");
        return;
      }

      if (end <= s) {
        showAvailAlert("error", "Check-out date must be at least one day after check-in date.");
        return;
      }

      const n = nights();
      const cinDisplay = sVal.split("-").reverse().join("-");
      const coutDisplay = eVal.split("-").reverse().join("-");

      if (cart) {
        renderSidebar();
      }

      applyFilterAndSort();

      showAvailAlert(
        "success",
        `✓ <strong>${rooms.length} stay type(s) available</strong> for <strong>${n} Night(s)</strong> (${cinDisplay} to ${coutDisplay}).`
      );

      const mainCol = document.querySelector(".bk-main-col");
      if (mainCol) {
        mainCol.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // ── Checkout Modal Functions ─────────────────────────────────────────────────
  function updateCheckoutModalSummary() {
    if (!cart) return null;
    const modalCi = $("bkModalCheckIn");
    const modalCo = $("bkModalCheckOut");
    const inVal = (modalCi && modalCi.value) || (ci && ci.value);
    const outVal = (modalCo && modalCo.value) || (co && co.value);

    const s = new Date(inVal + "T00:00:00");
    const e = new Date(outVal + "T00:00:00");
    const n = Math.max(Math.round((e - s) / 86400000), 1);

    const incRate = cart.incRate;
    const excRate = incRate / 1.05;

    const extraChildInc = Math.round(incRate * 0.2);
    const extraChildExc = extraChildInc / 1.05;
    const extraChildCostExc = extraChildExc * (cart.children || 0);

    const roomRentExc = (excRate + extraChildCostExc) * n;
    const tax = roomRentExc * 0.05;
    const exact = roomRentExc + tax;
    const total = Math.round(exact);

    // Sync hidden form inputs
    if ($("bkRoom")) $("bkRoom").value = cart.name;
    if ($("bkCheckIn")) $("bkCheckIn").value = inVal;
    if ($("bkCheckOut")) $("bkCheckOut").value = outVal;
    if ($("bkAdults")) $("bkAdults").value = cart.adults;
    if ($("bkChildren")) $("bkChildren").value = cart.children;

    // Date formatting: DD-MM-YYYY
    const fmtDate = (v) => (v ? v.split("-").reverse().join("-") : "--");
    const cinD = fmtDate(inVal);
    const coutD = fmtDate(outVal);

    // Update modal summary card
    if ($("ckCinVal")) $("ckCinVal").textContent = cinD;
    if ($("ckCoutVal")) $("ckCoutVal").textContent = coutD;
    if ($("ckSumRoomName")) $("ckSumRoomName").textContent = cart.name;
    if ($("ckSumRoomDetail")) {
      $("ckSumRoomDetail").innerHTML =
        `${n} Night${n > 1 ? "s" : ""} &bull; ` +
        `${cart.adults} Adult${cart.adults > 1 ? "s" : ""}` +
        (cart.children > 0 ? ` &bull; ${cart.children} Child` : "") +
        (cart.extra > 0 ? ` &bull; ${cart.extra} Extra Bed` : "");
    }
    if ($("ckSumRoomPrice")) $("ckSumRoomPrice").textContent = "₹" + total.toLocaleString("en-IN") + ".00";

    // Check availability for these dates
    const submitBtn = $("bkSubmitBtn") || (bkForm && bkForm.querySelector("button[type='submit']"));
    const msg = $("bkFormMsg");
    const blocked = isRoomBlockedForDates(cart.name, inVal, outVal);

    if (blocked) {
      if (msg) {
        msg.style.display = "block";
        msg.className = "bk-msg error";
        msg.textContent = "This cabin is already booked for the selected dates. Please choose different dates.";
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (msg && msg.textContent.includes("already booked")) {
        msg.style.display = "none";
        msg.textContent = "";
      }
      if (submitBtn) submitBtn.disabled = false;
    }

    return { n, total, inVal, outVal };
  }

  function openCheckout() {
    if (!cart) return;

    const modalCi = $("bkModalCheckIn");
    const modalCo = $("bkModalCheckOut");

    if (modalCi && ci) {
      modalCi.min = toVal(today);
      modalCi.value = ci.value || toVal(addDay(today, 1));
    }
    if (modalCo && co && ci) {
      const s = new Date((ci.value || toVal(addDay(today, 1))) + "T00:00:00");
      modalCo.min = toVal(addDay(s, 1));
      modalCo.value = co.value || toVal(addDay(today, 2));
    }

    updateCheckoutModalSummary();

    const overlay = $("bkOverlay");
    if (overlay) {
      overlay.classList.add("is-open");
      overlay.classList.add("open");
      overlay.scrollTop = 0;
    }
    document.body.style.overflow = "hidden";
  }

  function closeCheckout() {
    const overlay = $("bkOverlay");
    if (overlay) {
      overlay.classList.remove("is-open");
      overlay.classList.remove("open");
    }
    document.body.style.overflow = "";
    const msg = $("bkFormMsg");
    if (msg) {
      msg.style.display = "none";
      msg.textContent = "";
    }
  }

  const closeBtn = $("bkCloseModal");
  if (closeBtn) closeBtn.addEventListener("click", closeCheckout);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCheckout();
  });

  // Modal Date Change Listeners
  const modalCi = $("bkModalCheckIn");
  const modalCo = $("bkModalCheckOut");

  if (modalCi) {
    modalCi.addEventListener("change", () => {
      if (ci) ci.value = modalCi.value;
      const s = new Date(modalCi.value + "T00:00:00");
      if (modalCo) {
        modalCo.min = toVal(addDay(s, 1));
        if (new Date(modalCo.value + "T00:00:00") <= s) {
          modalCo.value = toVal(addDay(s, 1));
          if (co) co.value = modalCo.value;
        }
      }
      updateNightsBadge();
      renderSidebar();
      updateCheckoutModalSummary();
    });
  }

  if (modalCo) {
    modalCo.addEventListener("change", () => {
      if (co) co.value = modalCo.value;
      updateNightsBadge();
      renderSidebar();
      updateCheckoutModalSummary();
    });
  }

  // ── Form Submit — CCAvenue Payment ────────────────────────────────────────
  const bkForm = $("bkForm");
  if (bkForm) {
    bkForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!cart) return;

      const modalCheckInEl = $("bkModalCheckIn");
      const modalCheckOutEl = $("bkModalCheckOut");
      const check_in = (modalCheckInEl && modalCheckInEl.value) || (ci && ci.value);
      const check_out = (modalCheckOutEl && modalCheckOutEl.value) || (co && co.value);

      if (!check_in || !check_out) {
        const msg = $("bkFormMsg");
        msg.style.display = "block";
        msg.className = "bk-msg error";
        msg.textContent = "Please select both check-in and check-out dates.";
        return;
      }

      if (isRoomBlockedForDates(cart.name, check_in, check_out)) {
        const msg = $("bkFormMsg");
        msg.style.display = "block";
        msg.className = "bk-msg error";
        msg.textContent = "This cabin is already booked for these dates. Please choose different dates.";
        return;
      }

      const s = new Date(check_in + "T00:00:00");
      const eDate = new Date(check_out + "T00:00:00");
      const n = Math.max(Math.round((eDate - s) / 86400000), 1);

      const incRate = cart.incRate;
      const excRate = incRate / 1.05;
      const extraChildInc = Math.round(incRate * 0.2);
      const extraChildExc = extraChildInc / 1.05;
      const extraChildCostExc = extraChildExc * (cart.children || 0);
      const roomRentExc = (excRate + extraChildCostExc) * n;
      const tax = roomRentExc * 0.05;
      const total = Math.round(roomRentExc + tax);

      const titleVal = $("bkTitle") ? $("bkTitle").value : "";
      const rawName = $("bkName").value.trim();
      const name = titleVal ? `${titleVal}. ${rawName}` : rawName;
      const email = $("bkEmail").value.trim();
      const phone = $("bkPhone").value.trim();
      const requests = $("bkRequests") ? $("bkRequests").value.trim() : "";

      if (!rawName || !phone) {
        const msg = $("bkFormMsg");
        msg.style.display = "block";
        msg.className = "bk-msg error";
        msg.textContent = "Please enter your name and phone number.";
        return;
      }

      const submitBtn = $("bkSubmitBtn") || bkForm.querySelector("button[type='submit']");
      const msg = $("bkFormMsg");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Redirecting to payment gateway…";
      }
      if (msg) msg.style.display = "none";

      // Save latest booking locally for the confirmation page
      localStorage.setItem(
        "cloudNandyLatestBooking",
        JSON.stringify({
          name,
          email,
          phone,
          room: cart.name,
          check_in,
          check_out,
          adults: cart.adults,
          children: cart.children,
          requests,
          total_amount: total,
        })
      );

      try {
        const payloadBody = JSON.stringify({
          name,
          email,
          phone,
          room: cart.name,
          check_in,
          check_out,
          adults: cart.adults,
          children: cart.children,
          requests,
          total_amount: total,
        });

        const MAX_RETRIES = 1;
        const TIMEOUT_MS = 45000;

        let resp;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

          try {
            resp = await fetch(API_BASE + "/api/payment/initiate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payloadBody,
              signal: controller.signal,
            });
            clearTimeout(timer);
            break;
          } catch (fetchErr) {
            clearTimeout(timer);
            if (attempt < MAX_RETRIES) {
              if (submitBtn) submitBtn.textContent = "Payment gateway waking up… retrying…";
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            throw fetchErr;
          }
        }

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Server error" }));
          throw new Error(err.error || "Could not initiate payment");
        }

        const html = await resp.text();
        document.open();
        document.write(html);
        document.close();
      } catch (err) {
        console.error("Payment error:", err);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Pay & Confirm Booking";
        }
        if (msg) {
          msg.style.display = "block";
          msg.className = "bk-msg error";
          const isNetworkErr = err.name === "AbortError" || err.message === "Failed to fetch";
          msg.textContent = isNetworkErr
            ? "⚠️ Could not reach the payment server. Please wait 30 seconds and try again."
            : "⚠️ Payment error: " + err.message + ". Please try again.";
        }
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  (async function init() {
    const list = $("bkRoomList");
    try {
      const [fetchedRooms] = await Promise.all([
        fetchRooms(),
        fetchConfirmedBookings(),
      ]);
      allRooms = fetchedRooms;
      initFilterAndSortControls();

      // Pre-select cart if arriving for a specific room
      if (selectedRoomFilter) {
        const matchedRoom = allRooms.find((r) => {
          const a = (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const b = selectedRoomFilter.toLowerCase().replace(/[^a-z0-9]/g, "");
          return a.includes(b) || b.includes(a);
        });

        if (matchedRoom && !isRoomBlocked(matchedRoom.name)) {
          const defaultAdults = paramGuests && Number(paramGuests) >= 1 && Number(paramGuests) <= 5 ? Number(paramGuests) : 2;
          cart = {
            id: matchedRoom.id,
            name: matchedRoom.name,
            incRate: matchedRoom.price,
            adults: defaultAdults,
            children: 0,
            extra: 0,
          };
          renderSidebar();
        }
      }

      applyFilterAndSort();
    } catch (err) {
      if (list)
        list.innerHTML = `<p style="color:#fca5a5;padding:40px;text-align:center;">Could not load luxury stays: ${esc(err.message)}</p>`;
    }
  })();
})();
