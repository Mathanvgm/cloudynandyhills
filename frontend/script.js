const API_BASE = "https://cloudynandyhills.onrender.com";

const today = new Date();
today.setHours(0, 0, 0, 0);

const dateToInputValue = (date) => date.toISOString().split("T")[0];

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatRupees = (amount) => `\u20B9${Number(amount).toLocaleString("en-IN")}`;

const truncateText = (text, maxLength = 100) => {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() + "..." : text;
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });

const normalizeProperty = (property) => ({
  id: property.id,
  name: property.name,
  type: property.type,
  price: Number(property.price),
  description: property.description,
  image_urls: (property.image_urls && property.image_urls.length)
    ? property.image_urls
    : [property.image_url || property.image].filter(Boolean),
  image: property.image_url || (property.image_urls && property.image_urls[0]) || property.image,
  image_url: property.image_url || (property.image_urls && property.image_urls[0]) || property.image,
  createdAt: property.created_at || property.createdAt,
});

const fetchProperties = async () => {
  const { data, error } = await window.supabaseClient
    .from(window.CLOUD_NANDY_SUPABASE.table)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data.map(normalizeProperty);
};

const quickBookingForm = document.querySelector("#quickBookingForm");
const quickCheckIn = document.querySelector("#quickCheckIn");
const quickCheckOut = document.querySelector("#quickCheckOut");
const quickGuests = document.querySelector("#quickGuests");
const roomGrid = document.querySelector(".room-grid");
const weatherTemp = document.querySelector("#weatherTemp");
const weatherCondition = document.querySelector("#weatherCondition");
const weatherMeta = document.querySelector("#weatherMeta");

const defaultCheckIn = addDays(today, 1);
const defaultCheckOut = addDays(today, 2);

[quickCheckIn].forEach((input) => {
  input.min = dateToInputValue(today);
  input.value = dateToInputValue(defaultCheckIn);
});

[quickCheckOut].forEach((input) => {
  input.min = dateToInputValue(addDays(defaultCheckIn, 1));
  input.value = dateToInputValue(defaultCheckOut);
});

const SKYROOMS_BOOKING_URL = "./booking.html";

const buildBookingUrl = (params = {}) => {
  return SKYROOMS_BOOKING_URL;
};

let allLoadedProperties = [];
let activeRoomFilter = "all";
let activeRoomSort = "featured";

const applyRoomFiltersAndSort = () => {
  if (!allLoadedProperties.length) return;

  let filtered = [...allLoadedProperties];

  // 1. Filter by category
  if (activeRoomFilter === "cabin") {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.description || ""}`.toLowerCase();
      return text.includes("cabin") || text.includes("wooden") || text.includes("house");
    });
  } else if (activeRoomFilter === "mountain") {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.description || ""}`.toLowerCase();
      return text.includes("mountain") || text.includes("view") || text.includes("afram") || text.includes("superior");
    });
  } else if (activeRoomFilter === "family") {
    filtered = filtered.filter(p => {
      const text = `${p.name} ${p.description || ""}`.toLowerCase();
      return text.includes("family") || text.includes("bedroom") || text.includes("two") || text.includes("dlx");
    });
  }

  // 2. Sort
  if (activeRoomSort === "price-asc") {
    filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  } else if (activeRoomSort === "price-desc") {
    filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  } else if (activeRoomSort === "name-asc") {
    filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  // Update count badge
  const countBadge = document.querySelector("#roomCountBadge");
  if (countBadge) {
    countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'Stay' : 'Stays'}`;
  }

  // Render cards
  if (!filtered.length) {
    roomGrid.innerHTML = '<p class="empty-list" style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">No stays found matching this category. Please select "All Rooms".</p>';
    return;
  }

  roomGrid.innerHTML = filtered
    .map(
      (property, i) => `
        <article class="room-card" data-room-card data-room="${escapeHtml(property.name)}" data-reveal data-delay="${Math.min(i, 5)}">
          <a href="#" class="lightbox-trigger" data-images="${escapeHtml(JSON.stringify(property.image_urls || [property.image]))}" data-index="0">
            <img src="${property.image}" alt="${escapeHtml(property.name)}" loading="lazy" />
          </a>
          <div class="room-body">
            <div>
              <a href="./property.html?id=${property.id}">
                <h3>${escapeHtml(property.name)}</h3>
              </a>
              <p class="room-card-desc">${escapeHtml(truncateText(property.description, 100))}</p>
              <div class="booking-card-thumbs" style="margin-top: 12px;">
                ${(property.image_urls || [property.image]).slice(0, 3).map((url, idx) => `
                  <a href="#" class="lightbox-trigger" data-images="${escapeHtml(JSON.stringify(property.image_urls || [property.image]))}" data-index="${idx}">
                    <img src="${url}" alt="Room preview" loading="lazy" />
                  </a>
                `).join('')}
                ${(property.image_urls || []).length > 3 ? `<span class="more-thumbs">+${property.image_urls.length - 3}</span>` : ''}
              </div>
            </div>
            <div class="room-meta">
              <span>${formatRupees(property.price)}/night</span>
              <div class="room-card-actions">
                <a class="text-button" href="./property.html?id=${property.id}">Details</a>
                <button class="text-button" type="button" data-room-select="${escapeHtml(property.name)}" data-room-id="${property.id}">
                  Book
                </button>
              </div>
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  if (window.initScrollAnimations) window.initScrollAnimations();
};

const initRoomControls = () => {
  const filterBtns = document.querySelectorAll("#indexRoomFilters .room-filter-btn");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeRoomFilter = btn.dataset.filter || "all";
      applyRoomFiltersAndSort();
    });
  });

  const sortSelect = document.querySelector("#indexRoomSort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      activeRoomSort = sortSelect.value;
      applyRoomFiltersAndSort();
    });
  }
};

const renderPublicUploadedProperties = async () => {
  roomGrid.innerHTML = '<p class="empty-list">Loading properties from Supabase...</p>';

  try {
    const properties = await fetchProperties();

    if (!properties.length) {
      roomGrid.innerHTML =
        '<p class="empty-list">No properties found in Supabase. Add one from the admin panel.</p>';
      const countBadge = document.querySelector("#roomCountBadge");
      if (countBadge) countBadge.textContent = "0 Stays";
      return;
    }

    allLoadedProperties = properties;
    initRoomControls();
    applyRoomFiltersAndSort();
  } catch (error) {
    roomGrid.innerHTML = `<p class="empty-list">Unable to load Supabase properties. ${escapeHtml(
      error.message,
    )}</p>`;
  }
};

const weatherLabels = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

const getWeatherTheme = (code) => {
  if ([0, 1].includes(code)) return "weather-clear";
  if ([2, 3].includes(code)) return "weather-cloudy";
  if ([45, 48].includes(code)) return "weather-misty";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code)) {
    return "weather-rainy";
  }
  return "weather-cloudy";
};

const applyWeatherTheme = (theme) => {
  document.body.classList.remove(
    "weather-clear",
    "weather-cloudy",
    "weather-rainy",
    "weather-misty",
  );
  document.body.classList.add(theme);
};

const getTemperatureTheme = (temperature) => {
  if (temperature < 16) return "temp-cool";
  if (temperature < 23) return "temp-mild";
  if (temperature < 29) return "temp-warm";
  return "temp-hot";
};

const applyTemperatureTheme = (temperature) => {
  document.body.classList.remove("temp-cool", "temp-mild", "temp-warm", "temp-hot");
  document.body.classList.add(getTemperatureTheme(temperature));
};

const loadKodaikanalWeather = async () => {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=10.2381&longitude=77.4892&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FKolkata";

  applyWeatherTheme("weather-cloudy");
  applyTemperatureTheme(20);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error("Weather service unavailable");
    }

    const data = await response.json();
    const current = data.current;
    const code = Number(current.weather_code);
    const temperature = Math.round(Number(current.temperature_2m));
    const condition = weatherLabels[code] || "Pleasant hill weather";

    // ── Animate temperature count-up ──────────────────────
    const duration = 1400;
    const startTime = performance.now();

    function animateTemp(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current_val = Math.round(eased * temperature);
      weatherTemp.textContent = `${current_val}\u00B0C`;
      if (progress < 1) {
        requestAnimationFrame(animateTemp);
      } else {
        weatherTemp.textContent = `${temperature}\u00B0C`;
      }
    }
    requestAnimationFrame(animateTemp);
    // ─────────────────────────────────────────────────────

    weatherCondition.textContent = condition;
    weatherMeta.textContent = `Humidity ${current.relative_humidity_2m}% | Wind ${Math.round(
      Number(current.wind_speed_10m),
    )} km/h`;
    applyWeatherTheme(getWeatherTheme(code));
    applyTemperatureTheme(temperature);
  } catch (error) {
    console.error("Failed to load Kodaikanal weather:", error);
    weatherTemp.textContent = "20\u00B0C";
    weatherCondition.textContent = "Pleasant hill weather";
    weatherMeta.textContent = "Humidity 68% | Wind 12 km/h";
    applyWeatherTheme("weather-cloudy");
    applyTemperatureTheme(20);
  }
};

quickCheckIn.addEventListener("change", () => {
  const selectedCheckIn = new Date(`${quickCheckIn.value}T00:00:00`);
  const minCheckout = addDays(selectedCheckIn, 1);
  quickCheckOut.min = dateToInputValue(minCheckout);

  if (new Date(`${quickCheckOut.value}T00:00:00`) <= selectedCheckIn) {
    quickCheckOut.value = dateToInputValue(minCheckout);
  }
});

quickBookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const params = new URLSearchParams({
    checkIn: quickCheckIn.value,
    checkOut: quickCheckOut.value,
    guests: quickGuests.value
  });
  window.location.href = `${SKYROOMS_BOOKING_URL}?${params.toString()}`;
});

roomGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-room-select]");
  if (button) {
    const roomName = button.getAttribute("data-room-select") || "";
    const params = new URLSearchParams({
      checkIn: quickCheckIn.value,
      checkOut: quickCheckOut.value,
      guests: quickGuests.value,
      room: roomName
    });
    window.location.href = `${SKYROOMS_BOOKING_URL}?${params.toString()}`;
  }
});

renderPublicUploadedProperties();
loadKodaikanalWeather();

// ── Header scroll: hide on scroll-down, show on scroll-up (throttled with rAF) ──
const header = document.getElementById("siteHeader");
let lastScrollY = window.scrollY;
const scrollThreshold = 5; // ignore tiny scroll movements
let scrollTicking = false;

window.addEventListener("scroll", () => {
  if (!scrollTicking) {
    window.requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;
      if (header) {
        // Add/remove the "scrolled" shrink class
        header.classList.toggle("scrolled", currentScrollY > 60);

        // Determine scroll direction and hide/show
        if (Math.abs(currentScrollY - lastScrollY) >= scrollThreshold) {
          if (currentScrollY > lastScrollY && currentScrollY > 80) {
            header.classList.add("header-hidden");
          } else {
            header.classList.remove("header-hidden");
          }
          lastScrollY = currentScrollY;
        }
      }
      scrollTicking = false;
    });
    scrollTicking = true;
  }
}, { passive: true });

// ── Room card stagger reveal (called after cards render) ──
function initRoomCardReveal() {
  const cards = document.querySelectorAll(".room-card");
  if (!cards.length) return;

  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        cardObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  cards.forEach((card, i) => {
    card.classList.add("reveal-card");
    card.style.transitionDelay = `${i * 120}ms`;
    cardObserver.observe(card);
  });
}

// Re-run when room grid content changes (after API loads cards)
const roomGridEl = document.getElementById("roomGrid");
if (roomGridEl) {
  new MutationObserver(() => initRoomCardReveal())
    .observe(roomGridEl, { childList: true });
}

// ── Mobile Navigation Toggle ──
const siteHeader = document.getElementById("siteHeader");
const navToggle = document.getElementById("navToggle");

if (navToggle && siteHeader) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteHeader.classList.toggle("nav-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  // Close when clicking nav links
  siteHeader.querySelectorAll(".nav a").forEach((link) => {
    link.addEventListener("click", () => {
      siteHeader.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  // Close when clicking outside header
  document.addEventListener("click", (e) => {
    if (!siteHeader.contains(e.target) && siteHeader.classList.contains("nav-open")) {
      siteHeader.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });

  // Close on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && siteHeader.classList.contains("nav-open")) {
      siteHeader.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}
