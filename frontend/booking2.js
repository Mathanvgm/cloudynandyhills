// ── booking2.js — Cloud Nandy Hills booking engine ──────────────────────────
(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────────
  const cfg = window.CLOUD_NANDY_SUPABASE;
  let db = null;

  if (window.supabase && cfg) {
    db = window.supabase.createClient(cfg.url, cfg.key);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toVal = (d) => d.toISOString().split("T")[0];
  const addDay = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const fmtRaw = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const esc = (v) => String(v || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  // ── Date Defaults ────────────────────────────────────────────────────────────
  const ci = $("checkIn");
  const co = $("checkOut");
  const rc = $("roomsCount");

  if (ci) {
    ci.min = toVal(today);
    ci.value = new URLSearchParams(window.location.search).get("checkIn") || toVal(addDay(today, 1));
    ci.addEventListener("change", () => {
      const s = new Date(ci.value + "T00:00:00");
      co.min = toVal(addDay(s, 1));
      if (new Date(co.value + "T00:00:00") <= s) co.value = toVal(addDay(s, 1));
      renderSidebar();
    });
  }
  if (co) {
    co.min = toVal(addDay(today, 2));
    co.value = new URLSearchParams(location.search).get("checkOut") || toVal(addDay(today, 2));
    co.addEventListener("change", () => renderSidebar());
  }

  const nights = () => {
    const s = new Date(ci.value + "T00:00:00");
    const e = new Date(co.value + "T00:00:00");
    return Math.max(Math.round((e - s) / 86400000), 1);
  };

  // ── SVG Icons ────────────────────────────────────────────────────────────────
  const personSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const twoPersonSVG = personSVG + personSVG;
  const childSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="3.5"/><path d="M7 21c0-3 2.5-5.5 5-5.5s5 2.5 5 5.5"/></svg>`;
  const extraSVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;

  // ── State ────────────────────────────────────────────────────────────────────
  let rooms = [];
  let cart = null;

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  function renderSidebar() {
    const sidebar = document.getElementById('bkSidebar');
    const body    = document.getElementById('bkSidebarBody');
    if (!sidebar || !body) return;

    if (!cart) {
      sidebar.classList.remove('active');
      return;
    }

    const n = nights();
    const cinDisplay  = ci.value.split('-').reverse().join('-');
    const coutDisplay = co.value.split('-').reverse().join('-');

    const incRate       = cart.incRate;
    const excRate       = incRate / 1.05;
    const extraChildInc = Math.round(incRate * 0.2);
    const extraChildExc = extraChildInc / 1.05;
    const extraChildCostExc = extraChildExc * cart.children;

    const roomRentExc = (excRate + extraChildCostExc) * n;
    const tax      = roomRentExc * 0.05;
    const exact    = roomRentExc + tax;
    const total    = Math.round(exact);
    const diff     = total - exact;
    const roundStr = (diff >= 0 ? '+ ' : '- ') + Math.abs(diff).toFixed(2);
    const abbr     = cart.name.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase() + '-STD (CP)';

    body.innerHTML = `
      <div class="bk-sb-dates">
        <strong>Dates</strong>${cinDisplay} to ${coutDisplay}
      </div>

      <div class="bk-sb-item-header">
        <span class="bk-sb-item-name">${esc(abbr)}</span>
        <button class="bk-sb-remove" id="bkSbRemove" title="Remove">✕</button>
      </div>

      <table class="bk-sb-config">
        <thead><tr><th>Room</th><th>Adult</th><th>Child</th><th>Extra</th></tr></thead>
        <tbody><tr>
          <td>1</td>
          <td>${cart.adults}</td>
          <td>${cart.children}</td>
          <td>${cart.extra}</td>
        </tr></tbody>
      </table>

      <div class="bk-sb-toggle" id="bkSbToggle">
        Price Details <span class="caret">▲</span>
      </div>

      <div class="bk-sb-breakdown" id="bkSbBreakdown">
        <div class="bk-sb-row bold">
          <strong>Total rent</strong><strong>${fmtRaw(roomRentExc)}</strong>
        </div>
        <div class="bk-sb-row italic">
          <small>Type 1 - Room 1 : ${n} days X ${fmtRaw(excRate + extraChildCostExc)}</small>
        </div>
        <div class="bk-sb-row"><span>Room Rent</span><span>${fmtRaw(roomRentExc)}</span></div>
        <div class="bk-sb-row"><span>Tax</span><span>${fmtRaw(tax)}</span></div>
        <div class="bk-sb-row"><span>Roundoff</span><span>${roundStr}</span></div>
      </div>

      <div class="bk-sb-total">
        <span>Total</span><span>₹${total}.00/-</span>
      </div>

      <button class="bk-sb-reserve" id="bkSbReserve">RESERVE</button>
    `;

    sidebar.classList.add('active');

    // Toggle price details
    document.getElementById('bkSbToggle').addEventListener('click', () => {
      const tog = document.getElementById('bkSbToggle');
      const bkd = document.getElementById('bkSbBreakdown');
      tog.classList.toggle('collapsed');
      bkd.classList.toggle('hidden');
    });

    // Remove button
    document.getElementById('bkSbRemove').addEventListener('click', () => {
      cart = null;
      renderSidebar();
      renderRooms();
    });

    // Reserve — open the checkout modal
    document.getElementById('bkSbReserve').addEventListener('click', openCheckout);
  }

  // ── Fetch Rooms ──────────────────────────────────────────────────────────────
  async function fetchRooms() {
    if (!db) throw new Error("Database not configured.");
    const { data, error } = await db
      .from(cfg.table)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(p => ({
      id: String(p.id),
      name: p.name || "Room",
      price: Number(p.price) || 0,
      images: (p.image_urls && p.image_urls.length) ? p.image_urls : [p.image_url || p.image].filter(Boolean),
    }));
  }

  // ── Render Rooms ─────────────────────────────────────────────────────────────
  function renderRooms() {
    const list = $("bkRoomList");
    if (!list) return;

    if (!rooms.length) {
      list.innerHTML = '<p class="bk-loading">No rooms available.</p>';
      return;
    }

    list.innerHTML = rooms.map((r, i) => {
      const inCart = cart && cart.id === r.id;
      const incRate = r.price;
      const excRate = incRate / 1.05;
      const extraChildInc = Math.round(incRate * 0.2);
      const extraChildExc = extraChildInc / 1.05;

      const imgs = r.images.length ? r.images : [""];
      const hasMulti = imgs.length > 1;
      const roomsLeft = inCart ? 0 : 1;

      const imgsJSON = esc(JSON.stringify(imgs));
      const imgSlides = imgs.map((url, idx) =>
        `<a href="#" class="lightbox-trigger" data-images="${imgsJSON}" data-index="${idx}" style="display:${idx > 0 ? 'none' : 'block'}">
          <img src="${esc(url)}" alt="${esc(r.name)} - Image ${idx+1}" class="bk-slide-img" />
        </a>`
      ).join("");

      const sliderBtns = hasMulti ? `
        <button class="bk-slider-btn prev" data-sid="${i}" aria-label="Prev">&#10094;</button>
        <button class="bk-slider-btn next" data-sid="${i}" aria-label="Next">&#10095;</button>` : "";

      const bookBtn = inCart
        ? `<span style="color:#b45f3c;font-weight:700;font-size:0.82rem;">Added</span>`
        : `<button class="bk-book-btn" data-rid="${esc(r.id)}">Book Room</button>`;

      return `
        <div class="bk-room-card" id="card-${esc(r.id)}">
          <div class="bk-room-title"><h3>${esc(r.name)}</h3></div>
          <div class="bk-room-body">

            <div class="bk-room-img-wrap">
              <div class="bk-img-slider" id="slider-${i}">
                ${imgSlides}
                ${sliderBtns}
              </div>
              <div class="bk-facilities">
                <h4>Facilities</h4>
                <div class="bk-fac-grid">
                  <span>TV</span><span>ADVANCED HEATER</span>
                  <span>TOWEL</span><span>WATER BOTTLE</span>
                </div>
              </div>
            </div>

            <div class="bk-room-details">
              <div class="bk-std-row">
                <span class="bk-std-label">STD <small style="font-weight:normal">(With Breakfast)</small></span>
                <span class="bk-std-price">${fmtRaw(excRate)}</span>
              </div>

              <table class="bk-rate-table">
                <thead>
                  <tr>
                    <th>Pax</th>
                    <th>${personSVG}</th>
                    <th>${twoPersonSVG}</th>
                    <th>${childSVG}</th>
                    <th>${extraSVG}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Rate</td>
                    <td>${fmt(excRate)}</td>
                    <td>${fmt(excRate)}</td>
                    <td>${fmt(extraChildExc)}</td>
                    <td>₹0</td>
                  </tr>
                </tbody>
              </table>

              <p class="bk-tax-note"><span style="color:red">*</span> Taxes added to Actual Rates depending on No.of Sleeps</p>

              <div class="bk-info-bar">
                <span class="bk-room-info-lbl"><span class="bk-i-icon">i</span> Room Info</span>
                <span>
                  <span class="bk-rooms-left">${roomsLeft} Room(s) Left</span>
                  ${bookBtn}
                </span>
              </div>

              <table class="bk-config-table" id="cfg-${esc(r.id)}">
                <thead>
                  <tr>
                    <th>Rooms</th>
                    <th>Adult <small style="font-weight:normal">(Pax Per Room)</small></th>
                    <th>Child <small style="font-weight:normal">(Total Pax)</small></th>
                    <th>Extra <small style="font-weight:normal">(Total Pax)</small></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>
                      <select class="bk-config-select" data-role="adults" data-rid="${esc(r.id)}">
                        <option value="1">1</option>
                        <option value="2" selected>2</option>
                        <option value="3">3</option>
                      </select>
                    </td>
                    <td>
                      <select class="bk-config-select" data-role="children" data-rid="${esc(r.id)}">
                        <option value="0" selected>0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </td>
                    <td>
                      <select class="bk-config-select" data-role="extra" data-rid="${esc(r.id)}">
                        <option value="0" selected>0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>`;
    }).join("");

    // Slider buttons
    list.querySelectorAll(".bk-slider-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const sid = btn.dataset.sid;
        const sldr = document.getElementById("slider-" + sid);
        const slides = sldr.querySelectorAll(".lightbox-trigger");
        let cur = [...slides].findIndex(s => s.style.display !== "none");
        slides[cur].style.display = "none";
        const dir = btn.classList.contains("next") ? 1 : -1;
        slides[(cur + dir + slides.length) % slides.length].style.display = "block";
      });
    });

    // Book Room buttons
    list.querySelectorAll(".bk-book-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const rid = btn.dataset.rid;
        const room = rooms.find(r => r.id === rid);
        if (!room) return;
        const cfg_tbl = document.getElementById("cfg-" + rid);
        cart = {
          id: rid,
          name: room.name,
          incRate: room.price,
          adults: Number(cfg_tbl.querySelector('[data-role="adults"]').value),
          children: Number(cfg_tbl.querySelector('[data-role="children"]').value),
          extra: parseInt(cfg_tbl.querySelector('[data-role="extra"]').value, 10),
        };
        renderRooms();
        renderSidebar(); // show sidebar instead of opening modal
      });
    });

    // Config selects — keep cart and sidebar in sync
    list.querySelectorAll(".bk-config-select").forEach(sel => {
      sel.addEventListener("change", () => {
        if (cart && cart.id === sel.dataset.rid) {
          const cfg_tbl = document.getElementById("cfg-" + cart.id);
          cart.adults   = parseInt(cfg_tbl.querySelector('[data-role="adults"]').value, 10);
          cart.children = parseInt(cfg_tbl.querySelector('[data-role="children"]').value, 10);
          cart.extra    = parseInt(cfg_tbl.querySelector('[data-role="extra"]').value, 10);
          renderSidebar();
        }
      });
    });
  }

  // ── Checkout Full-Page ─────────────────────────────────────────────────────────────
  function openCheckout() {
    if (!cart) return;
    const n              = nights();
    const incRate        = cart.incRate;
    const excRate        = incRate / 1.05;
    
    const extraChildInc  = Math.round(incRate * 0.2);
    const extraChildExc  = extraChildInc / 1.05;
    const extraChildCostExc = extraChildExc * cart.children;
    
    const roomRentExc = (excRate + extraChildCostExc) * n;
    const tax         = roomRentExc * 0.05;
    const exact       = roomRentExc + tax;
    const total       = Math.round(exact);
    const diff        = total - exact;

    // Hidden inputs
    $("bkRoom").value    = cart.name;
    $("bkCheckIn").value  = ci.value;
    $("bkCheckOut").value = co.value;
    $("bkAdults").value   = cart.adults;
    $("bkChildren").value = cart.children;

    // Format dates: YYYY-MM-DD -> DD-MM-YYYY
    const fmtDate = (v) => v.split('-').reverse().join('-');
    const cinD  = fmtDate(ci.value);
    const coutD = fmtDate(co.value);
    const abbr  = cart.name.split(' ').map(w => w[0]).join('').substring(0,3).toUpperCase() + '-STD (CP)';

    // Right-side summary card
    $("ckCinVal").textContent  = cinD;
    $("ckCoutVal").textContent = coutD;
    $("ckSumRoomName").textContent = cart.name + " - ( " + abbr + " )";
    $("ckSumRoomDetail").innerHTML =
      n + " night" + (n > 1 ? "s" : "") + " &bull; " +
      cart.adults + " Adult" + (cart.adults > 1 ? "s" : "") +
      (cart.children > 0 ? " &bull; " + cart.children + " Child" : "") +
      (cart.extra    > 0 ? " &bull; " + cart.extra    + " Extra" : "");
    $("ckSumRoomPrice").textContent = "Total: \u20b9" + total + ".00/-";

    // Modify button — close and go back to booking
    $("ckModifyBtn").onclick = closeCheckout;

    // Overview table
    $("ckOverviewBody").innerHTML =
      "<tr>" +
        "<td>" + cinD  + "</td>" +
        "<td>" + coutD + "</td>" +
        "<td>1</td><td>1</td>" +
        "<td>" + n + "</td>" +
        "<td>" + cart.adults   + "</td>" +
        "<td>" + cart.children + "</td>" +
        "<td>" + cart.extra    + "</td>" +
      "</tr>";

    // Rate breakdown table
    const childPaxRateStr = fmtRaw(cart.children > 0 ? extraChildExc : 0);
    $("ckRateBody").innerHTML =
      "<tr><td class='room-label' colspan='9'>" + esc(cart.name) + " &mdash; ( " + esc(abbr) + " )</td></tr>" +
      "<tr>" +
        "<td>1.</td>" +
        "<td>" + cart.adults   + "</td>" +
        "<td>" + cart.children + "</td>" +
        "<td>" + cart.extra    + "</td>" +
        "<td>" + fmtRaw(excRate) + "</td>" +
        "<td>0.00</td>" +
        "<td>" + childPaxRateStr + "</td>" +
        "<td>" + fmtRaw(tax) + "</td>" +
        "<td>" + fmtRaw(roomRentExc + tax) + "</td>" +
      "</tr>" +
      "<tr class='subtotal'>" +
        "<td><strong>Total</strong></td>" +
        "<td><strong>" + cart.adults   + "</strong></td>" +
        "<td><strong>" + cart.children + "</strong></td>" +
        "<td><strong>" + cart.extra    + "</strong></td>" +
        "<td><strong>" + fmtRaw(excRate) + "</strong></td>" +
        "<td><strong>0.00</strong></td>" +
        "<td><strong>" + childPaxRateStr + "</strong></td>" +
        "<td><strong>" + fmtRaw(tax) + "</strong></td>" +
        "<td><strong>" + fmtRaw(roomRentExc + tax) + "</strong></td>" +
      "</tr>";

    // Totals
    $("ckRoundoffLine").textContent = "Round-off Amount : " + Math.abs(diff).toFixed(2);
    $("ckGrandTotal").innerHTML     = "Total Payable Amount : <span style='color:#b45f3c;font-size:1.2rem;font-weight:800'>\u20b9" + total + ".00</span>";


    $("bkOverlay").classList.add("open");
    $("bkOverlay").scrollTop = 0;
    document.body.style.overflow = "hidden";
  }

  function closeCheckout() {
    $("bkOverlay").classList.remove("open");
    document.body.style.overflow = "";
    const msg = $("bkFormMsg");
    if (msg) { msg.style.display = "none"; msg.textContent = ""; }
  }

  $("bkCloseModal").addEventListener("click", closeCheckout);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeCheckout(); });

  // ── Form Submit — CCAvenue Payment ────────────────────────────────────────
  $("bkForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!cart) return;

    const n              = nights();
    const incRate        = cart.incRate;
    const excRate        = incRate / 1.05;
    const extraChildInc  = Math.round(incRate * 0.2);
    const extraChildExc  = extraChildInc / 1.05;
    const extraChildCostExc = extraChildExc * cart.children;
    const roomRentExc    = (excRate + extraChildCostExc) * n;
    const tax            = roomRentExc * 0.05;
    const total          = Math.round(roomRentExc + tax);

    const name     = $("bkName").value.trim();
    const email    = $("bkEmail").value.trim();
    const phone    = $("bkPhone").value.trim();
    const requests = $("bkRequests") ? $("bkRequests").value.trim() : "";

    if (!name || !phone) {
      const msg = $("bkFormMsg");
      msg.style.display = "block";
      msg.className = "bk-msg error";
      msg.textContent = "Please enter your name and phone number.";
      return;
    }

    const submitBtn = $("bkForm").querySelector(".ck-book-now");
    const msg       = $("bkFormMsg");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Redirecting to payment…";
    }
    msg.style.display = "none";

    // ── API base URL ───────────────────────────────────────────────────────
    const apiBase = "https://cloudnandy-1cvn.onrender.com";

    // Save booking details for the payment-return page to display
    localStorage.setItem("cloudNandyLatestBooking", JSON.stringify({
      name, email, phone,
      room: cart.name,
      check_in: ci.value,
      check_out: co.value,
    }));

    try {
      const payloadBody = JSON.stringify({
        name,
        email,
        phone,
        room: cart.name,
        check_in: ci.value,
        check_out: co.value,
        adults: cart.adults,
        children: cart.children,
        requests,
        total_amount: total,
      });

      // Fetch with timeout + 1 automatic retry (Render free tier cold-starts)
      const MAX_RETRIES = 1;
      const TIMEOUT_MS  = 45000; // 45 seconds (Render can take 30-60s to wake)

      let resp;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          resp = await fetch(apiBase + "/api/payment/initiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payloadBody,
            signal: controller.signal,
          });
          clearTimeout(timer);
          break; // success — exit retry loop
        } catch (fetchErr) {
          clearTimeout(timer);
          if (attempt < MAX_RETRIES) {
            // Server may be cold-starting — wait 3s and retry once
            if (submitBtn) submitBtn.textContent = "Server waking up… retrying…";
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          throw fetchErr; // final attempt failed
        }
      }

      if (!resp.ok) {
        // Server returned a JSON error
        const err = await resp.json().catch(() => ({ error: "Server error" }));
        throw new Error(err.error || "Could not initiate payment");
      }

      // The server returns an HTML page that auto-submits to CCAvenue.
      // We render it in a full-page iframe / replace the current document.
      const html = await resp.text();
      document.open();
      document.write(html);
      document.close();

    } catch (err) {
      console.error("Payment initiation error:", err);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Book Now";
      }
      msg.style.display = "block";
      msg.className = "bk-msg error";
      const isNetworkErr = err.name === "AbortError" || err.message === "Failed to fetch";
      msg.textContent = isNetworkErr
        ? "⚠️ Could not reach the payment server. It may be starting up — please wait 30 seconds and try again."
        : "⚠️ Payment gateway error: " + err.message + ". Please try again.";
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  (async function init() {
    const list = $("bkRoomList");
    try {
      rooms = await fetchRooms();
      renderRooms();
    } catch (err) {
      if (list) list.innerHTML = `<p class="bk-loading" style="color:red;">Could not load rooms: ${esc(err.message)}</p>`;
    }
  })();

})();
