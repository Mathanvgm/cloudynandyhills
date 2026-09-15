const API_BASE = "https://cloudnandy-1cvn.onrender.com";

const today = new Date();
today.setHours(0, 0, 0, 0);

const dateToInputValue = (date) => date.toISOString().split("T")[0];

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatRupees = (amount) => `\u20B9${Number(amount).toLocaleString("en-IN")}`;

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
  guests_allowed: property.guests_allowed,
  check_in: property.check_in,
  check_out: property.check_out,
  image_urls: property.image_urls?.length
    ? property.image_urls
    : [property.image_url || property.image].filter(Boolean),
  image: property.image_url || property.image_urls?.[0] || property.image,
  image_url: property.image_url || property.image_urls?.[0] || property.image,
  createdAt: property.created_at || property.createdAt,
});

const fetchPropertyById = async (id) => {
  const { data, error } = await window.supabaseClient
    .from(window.CLOUD_NANDY_SUPABASE.table)
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(error.message || "Property not found.");
  }
  return normalizeProperty(data);
};


// Elements
const loadingState = document.querySelector("#loadingState");
const propertyContent = document.querySelector("#propertyContent");

const propertyHeroBanner = document.querySelector("#propertyHeroBanner");
const propertyHeroType = document.querySelector("#propertyHeroType");
const propertyHeroName = document.querySelector("#propertyHeroName");
const propertyHeroPrice = document.querySelector("#propertyHeroPrice");

const galleryMainImage = document.querySelector("#galleryMainImage");
const galleryThumbnails = document.querySelector("#galleryThumbnails");

const propertyDescriptionText = document.querySelector("#propertyDescriptionText");
const propertySpecsGrid = document.querySelector("#propertySpecsGrid");
const specRoomType = document.querySelector("#specRoomType");
const specGuestsAllowed = document.querySelector("#specGuestsAllowed");
const specCheckIn = document.querySelector("#specCheckIn");
const specCheckOut = document.querySelector("#specCheckOut");

const widgetPriceVal = document.querySelector("#widgetPriceVal");
const widgetCheckIn = document.querySelector("#widgetCheckIn");
const widgetCheckOut = document.querySelector("#widgetCheckOut");
const widgetGuests = document.querySelector("#widgetGuests");

const widgetSummaryRate = document.querySelector("#widgetSummaryRate");
const widgetSummaryNights = document.querySelector("#widgetSummaryNights");
const widgetSummaryTotal = document.querySelector("#widgetSummaryTotal");

const widgetBookingForm = document.querySelector("#widgetBookingForm");

let currentProperty = null;

const getNightCount = () => {
  const start = new Date(`${widgetCheckIn.value}T00:00:00`);
  const end = new Date(`${widgetCheckOut.value}T00:00:00`);
  const diff = Math.round((end - start) / 86400000);
  return Math.max(diff, 1);
};

const updateWidgetSummary = () => {
  if (!currentProperty) return;
  const nights = getNightCount();
  const rate = currentProperty.price;

  widgetSummaryRate.textContent = formatRupees(rate);
  widgetSummaryNights.textContent = `${nights} night${nights > 1 ? "s" : ""}`;
  widgetSummaryTotal.textContent = formatRupees(nights * rate);
};

const syncCheckoutMinimum = () => {
  const selectedCheckIn = new Date(`${widgetCheckIn.value}T00:00:00`);
  const minCheckout = addDays(selectedCheckIn, 1);
  widgetCheckOut.min = dateToInputValue(minCheckout);

  if (new Date(`${widgetCheckOut.value}T00:00:00`) <= selectedCheckIn) {
    widgetCheckOut.value = dateToInputValue(minCheckout);
  }

  updateWidgetSummary();
};

const setupWidgetForm = (property) => {
  const defaultCheckIn = addDays(today, 1);
  const defaultCheckOut = addDays(today, 2);

  widgetCheckIn.min = dateToInputValue(today);
  widgetCheckIn.value = dateToInputValue(defaultCheckIn);
  widgetCheckOut.min = dateToInputValue(addDays(defaultCheckIn, 1));
  widgetCheckOut.value = dateToInputValue(defaultCheckOut);

  widgetCheckIn.addEventListener("change", syncCheckoutMinimum);
  widgetCheckOut.addEventListener("change", updateWidgetSummary);
  widgetGuests.addEventListener("change", updateWidgetSummary);

  updateWidgetSummary();

  widgetBookingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "./booking.html";
  });
};

const renderPropertyDetails = (property) => {
  document.title = `${property.name} | Cloud Nandy`;

  // Hero section
  propertyHeroType.textContent = property.type || "Room";
  propertyHeroName.textContent = property.name;
  propertyHeroPrice.textContent = formatRupees(property.price);

  if (property.image) {
    propertyHeroBanner.style.backgroundImage = `linear-gradient(180deg, rgba(17, 25, 22, 0.45) 0%, rgba(17, 25, 22, 0.84) 100%), url("${property.image}")`;
  }

  // Left column: Description & specs
  propertyDescriptionText.textContent = property.description;
  
  if (propertySpecsGrid) {
    specRoomType.textContent = property.type || "Room";
    
    if (specGuestsAllowed) specGuestsAllowed.textContent = property.guests_allowed || "N/A";
    if (specCheckIn) specCheckIn.textContent = property.check_in || "N/A";
    if (specCheckOut) specCheckOut.textContent = property.check_out || "N/A";
  }

  // Gallery
  if (property.image_urls && property.image_urls.length > 0) {
    galleryMainImage.src = property.image_urls[0];
    galleryMainImage.alt = property.name;

    galleryThumbnails.innerHTML = property.image_urls
      .map((url, idx) => `
        <img src="${url}" alt="${escapeHtml(property.name)} view ${idx + 1}" class="thumbnail-item ${idx === 0 ? "active" : ""}" data-index="${idx}" />
      `)
      .join("");

    galleryThumbnails.addEventListener("click", (event) => {
      const thumb = event.target.closest(".thumbnail-item");
      if (!thumb) return;

      // Update active state
      document.querySelectorAll(".thumbnail-item").forEach(item => item.classList.remove("active"));
      thumb.classList.add("active");

      // Smooth opacity cross-fade
      galleryMainImage.style.opacity = "0.2";
      setTimeout(() => {
        galleryMainImage.src = property.image_urls[Number(thumb.dataset.index)];
        galleryMainImage.style.opacity = "1";
      }, 150);
    });
  }

  // Widget pricing
  widgetPriceVal.textContent = formatRupees(property.price);

  setupWidgetForm(property);

  // Toggle sections
  loadingState.hidden = true;
  propertyContent.hidden = false;
};

const initializePropertyPage = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");

  if (!id) {
    loadingState.innerHTML = `
      <p class="empty-list">No property specified. <a href="./index.html#rooms" style="text-decoration: underline;">Back to Rooms</a></p>
    `;
    return;
  }

  try {
    const property = await fetchPropertyById(id);
    currentProperty = property;
    renderPropertyDetails(property);
  } catch (error) {
    loadingState.innerHTML = `
      <p class="empty-list">Unable to load property details. ${escapeHtml(error.message)}<br><br><a href="./index.html#rooms" style="text-decoration: underline;">Back to Rooms</a></p>
    `;
  }
};

initializePropertyPage();
