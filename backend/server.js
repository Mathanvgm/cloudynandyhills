require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ──────────────────────────────────────────────────────────────────

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SUPABASE_BUCKET = "property-images",
  SUPABASE_TABLE = "properties",
  ALLOWED_ORIGIN = "*",
  CCAVENUE_MERCHANT_ID,
  CCAVENUE_ACCESS_CODE,
  CCAVENUE_WORKING_KEY,
  CCAVENUE_URL,
  CCAVENUE_REDIRECT_DOMAIN,
  BACKEND_URL,
  FRONTEND_URL,
} = process.env;

// PORT must come directly from process.env — Render injects its own PORT value
const PORT = process.env.PORT || 3000;

console.log("🚀 Starting Cloud Nandy API...");
console.log("   PORT          :", PORT);
console.log("   NODE_ENV      :", process.env.NODE_ENV);
console.log("   SUPABASE_URL  :", SUPABASE_URL ? "✅ set" : "❌ MISSING");
console.log("   SERVICE_KEY   :", SUPABASE_SERVICE_KEY ? "✅ set" : "❌ MISSING");
console.log("   CCA_MERCHANT  :", CCAVENUE_MERCHANT_ID ? "✅ set" : "❌ MISSING");

// Provide safe defaults AFTER reading from env (never overwrite a real value)
const CCA_GATEWAY_URL  = CCAVENUE_URL || "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction";
const API_BASE_URL     = BACKEND_URL  || "http://localhost:3000";
const UI_BASE_URL      = FRONTEND_URL || "http://localhost:49383";

// CCAvenue MUST post back to the API server (Render), NOT the website domain.
// CCAVENUE_REDIRECT_DOMAIN is kept for backward compatibility but API_BASE_URL takes priority.
const CCA_REDIRECT_DOMAIN = API_BASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "❌ Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY"
  );
  process.exit(1);
}

// Service-role client → bypasses ALL Supabase RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      // Allow "null" string origin from file:// protocol (local development)
      // When ALLOWED_ORIGIN is "*", accept every origin.
      if (
        !origin ||
        origin === "null" ||
        ALLOWED_ORIGIN === "*" ||
        origin === ALLOWED_ORIGIN
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

// Handle OPTIONS preflight explicitly for all routes
app.options("*", cors());
app.use(express.json());

// Multer: store uploaded files in memory so we can pipe them to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalizeProperty = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  price: Number(row.price),
  description: row.description,
  image_url: row.image_url,
  image_urls: Array.isArray(row.image_urls) ? row.image_urls : [],
  createdAt: row.created_at,
});

/**
 * Upload one file buffer to Supabase Storage.
 * Returns the public URL string.
 */
const uploadFileToStorage = async (file) => {
  const ext = file.originalname.split(".").pop() || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
};

const sendError = (res, status, message) =>
  res.status(status).json({ error: message });

// ─── CCAvenue Crypto Helpers ──────────────────────────────────────────────────

/**
 * CCAvenue AES-128-CBC encryption.
 * Key: MD5 hash of the working key (16 bytes).
 * IV:  fixed byte sequence 0x00..0x0f (as per CCAvenue official Node.js kit).
 */
function ccaEncrypt(plainText, workingKey) {
  const key = crypto.createHash("md5").update(workingKey).digest();
  const iv  = Buffer.from([0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
                           0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  let enc = cipher.update(plainText, "utf8", "hex");
  enc += cipher.final("hex");
  return enc;
}

/**
 * CCAvenue AES-128-CBC decryption.
 */
function ccaDecrypt(encText, workingKey) {
  const key = crypto.createHash("md5").update(workingKey).digest();
  const iv  = Buffer.from([0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
                           0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f]);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  let dec = decipher.update(encText, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

/**
 * Parse CCAvenue's key=value&key=value response into an object.
 */
function parseCCAResponse(decrypted) {
  const result = {};
  decrypted.split("&").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      result[pair.substring(0, idx)] = pair.substring(idx + 1);
    }
  });
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Root route
app.get("/", (_req, res) => {
  res.json({
    service: "Cloud Nandy Hills API",
    status: "running",
    version: "1.0.0",
    endpoints: ["/api/health", "/api/properties", "/api/bookings", "/api/payment/initiate"],
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// GET /api/properties — list all
app.get("/api/properties", async (_req, res) => {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return sendError(res, 500, error.message);
  res.json(data.map(normalizeProperty));
});

// GET /api/properties/:id — single property
app.get("/api/properties/:id", async (req, res) => {
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("*")
    .eq("id", req.params.id);

  if (error) return sendError(res, 500, error.message);
  if (!data || !data.length) return sendError(res, 404, "Property not found.");
  res.json(normalizeProperty(data[0]));
});

// POST /api/properties — create with image upload
app.post(
  "/api/properties",
  upload.array("images", 10),
  async (req, res) => {
    const { name, type, price, description } = req.body;

    if (!name || !type || !price || !description) {
      return sendError(res, 400, "Missing required fields: name, type, price, description");
    }

    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, "At least one image file is required.");
    }

    let imageUrls;
    try {
      imageUrls = await Promise.all(req.files.map(uploadFileToStorage));
    } catch (err) {
      return sendError(res, 500, err.message);
    }

    const { error: insertError } = await supabase.from(SUPABASE_TABLE).insert({
      name,
      type,
      price: Number(price),
      description,
      image_url: imageUrls[0],
      image_urls: imageUrls,
    });

    if (insertError) {
      console.error("INSERT error:", insertError);
      return sendError(res, 500, insertError.message);
    }

    // Fetch the inserted row
    const { data, error: fetchError } = await supabase
      .from(SUPABASE_TABLE)
      .select("*")
      .eq("image_url", imageUrls[0])
      .order("created_at", { ascending: false })
      .limit(1);

    if (fetchError) return sendError(res, 500, fetchError.message);
    if (!data || !data.length) return sendError(res, 500, "Insert may have been blocked by Supabase RLS. Please run supabase-setup.sql in your Supabase SQL Editor.");
    res.status(201).json(normalizeProperty(data[0]));
  }
);

// PUT /api/properties/:id — update (images optional)
app.put(
  "/api/properties/:id",
  upload.array("images", 10),
  async (req, res) => {
    const { id } = req.params;
    const { name, type, price, description } = req.body;

    if (!name || !type || !price || !description) {
      return sendError(res, 400, "Missing required fields: name, type, price, description");
    }

    // Resolve image URLs — use newly uploaded ones, or keep the existing list
    let imageUrls;
    if (req.files && req.files.length > 0) {
      try {
        imageUrls = await Promise.all(req.files.map(uploadFileToStorage));
      } catch (err) {
        return sendError(res, 500, err.message);
      }
    } else {
      // Fallback: read existing URLs from body (sent as JSON string)
      try {
        imageUrls = req.body.existing_image_urls
          ? JSON.parse(req.body.existing_image_urls)
          : [];
      } catch {
        imageUrls = [];
      }
    }

    const { data: updatedData, error: updateError } = await supabase
      .from(SUPABASE_TABLE)
      .update({
        name,
        type,
        price: Number(price),
        description,
        image_url: imageUrls[0] || null,
        image_urls: imageUrls,
      })
      .eq("id", id)
      .select();

    if (updateError) {
      console.error("UPDATE error:", updateError);
      return sendError(res, 500, updateError.message);
    }

    if (!updatedData || updatedData.length === 0) {
      console.error("UPDATE silent fail — RLS may be blocking writes. Run supabase-setup.sql.");
      return sendError(res, 403, "Update was blocked by Supabase RLS. Please run supabase-setup.sql in your Supabase SQL Editor and ensure your SUPABASE_SERVICE_KEY is the service_role key.");
    }

    console.log(`Updated property ${id} successfully`);
    res.json(normalizeProperty(updatedData[0]));
  }
);

// DELETE /api/properties/:id
app.delete("/api/properties/:id", async (req, res) => {
  const { data: deletedData, error } = await supabase
    .from(SUPABASE_TABLE)
    .delete()
    .eq("id", req.params.id)
    .select();

  if (error) {
    console.error("DELETE error:", error);
    return sendError(res, 500, error.message);
  }

  if (!deletedData || deletedData.length === 0) {
    console.error("DELETE silent fail — RLS may be blocking deletes. Run supabase-setup.sql.");
    return sendError(res, 403, "Delete was blocked by Supabase RLS. Please run supabase-setup.sql in your Supabase SQL Editor and ensure your SUPABASE_SERVICE_KEY is the service_role key.");
  }

  console.log(`Deleted property ${req.params.id} successfully`);
  res.json({ ok: true });
});

// ─── Booking Route (save to admin, no payment) ───────────────────────────────

/**
 * POST /api/bookings
 * Body (JSON):
 *   { name, email, phone, room, check_in, check_out, adults, children,
 *     requests, total_amount }
 *
 * Saves a booking row in Supabase with status = 'pending'.
 * Admin can then Confirm or Reject from the admin panel.
 */
app.post("/api/bookings", async (req, res) => {
  const {
    name, email, phone, room,
    check_in, check_out, adults, children,
    requests, total_amount,
  } = req.body;

  if (!name || !phone || !room || !check_in || !check_out) {
    return sendError(res, 400, "Missing required booking fields: name, phone, room, check_in, check_out");
  }

  const orderId = "CNH-" + Date.now() + "-" + Math.floor(Math.random() * 9000 + 1000);

  const { data: insertedRows, error: insertError } = await supabase
    .from("bookings")
    .insert([{
      name,
      email: email || null,
      phone,
      room,
      check_in,
      check_out,
      adults:       Number(adults)       || 1,
      children:     Number(children)     || 0,
      requests:     requests             || null,
      total_amount: Number(total_amount) || 0,
      status:       "pending",
      order_id:     orderId,
      booked_at:    new Date().toISOString(),
    }])
    .select("id");

  if (insertError) {
    console.error("Booking insert error:", insertError);
    return sendError(res, 500, "Failed to save booking: " + insertError.message);
  }

  const bookingId = insertedRows && insertedRows[0] ? insertedRows[0].id : null;
  console.log(`New booking saved — order: ${orderId}, id: ${bookingId}`);

  res.status(201).json({ ok: true, order_id: orderId, booking_id: bookingId });
});

// ─── GET /api/bookings/confirmed ─────────────────────────────────────────────
/**
 * Returns only confirmed bookings with room, check_in, check_out fields.
 * Used by the booking page to block already-booked room dates.
 * No PII (name, email, phone) is returned — safe for public access.
 */
app.get("/api/bookings/confirmed", async (_req, res) => {
  const { data, error } = await supabase
    .from("bookings")
    .select("room, check_in, check_out")
    .eq("status", "confirmed");

  if (error) {
    console.error("confirmed bookings fetch error:", error);
    return sendError(res, 500, error.message);
  }

  res.json(data || []);
});

// ─── Payment Routes (CCAvenue) ────────────────────────────────────────────────

/**
 * POST /api/payment/initiate
 * Body (JSON):
 *   { name, email, phone, room, check_in, check_out, adults, children,
 *     requests, total_amount }
 *
 * 1. Saves a booking row in Supabase with status = 'pending'
 * 2. Encrypts the order params for CCAvenue
 * 3. Returns an HTML page that auto-submits a form to CCAvenue
 */
app.post("/api/payment/initiate", async (req, res) => {
  if (!CCAVENUE_MERCHANT_ID || !CCAVENUE_ACCESS_CODE || !CCAVENUE_WORKING_KEY) {
    return sendError(res, 500, "CCAvenue credentials are not configured on the server.");
  }

  const {
    name, email, phone, room,
    check_in, check_out, adults, children,
    requests, total_amount,
  } = req.body;

  if (!name || !phone || !room || !check_in || !check_out || !total_amount) {
    return sendError(res, 400, "Missing required booking fields.");
  }

  // Generate a unique order ID
  const orderId = "CNH-" + Date.now() + "-" + Math.floor(Math.random() * 9000 + 1000);

  // 1. Save booking as CONFIRMED immediately in Supabase.
  //    If CCAvenue returns with failure/abort, status is downgraded to cancelled/failed.
  //    Saving as confirmed upfront ensures the booking is visible in admin right away.
  const { data: insertedRows, error: insertError } = await supabase
    .from("bookings")
    .insert([{
      name,
      email: email || null,
      phone,
      room,
      check_in,
      check_out,
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      requests: requests || null,
      total_amount: Number(total_amount),
      status: "confirmed",
      order_id: orderId,
      booked_at: new Date().toISOString(),
    }])
    .select("id");

  if (insertError) {
    console.error("Booking insert error:", insertError);
    return sendError(res, 500, "Failed to create booking: " + insertError.message);
  }

  const bookingId = insertedRows && insertedRows[0] ? insertedRows[0].id : null;

  // 2. Build CCAvenue order params string
  const returnUrl = `${CCA_REDIRECT_DOMAIN.replace(/\/$/, "")}/api/payment/return`;
  const cancelUrl = `${CCA_REDIRECT_DOMAIN.replace(/\/$/, "")}/api/payment/return?status=cancelled&order_id=${orderId}`;

  const orderParams = [
    `merchant_id=${CCAVENUE_MERCHANT_ID}`,
    `order_id=${orderId}`,
    `amount=${Number(total_amount).toFixed(2)}`,
    `currency=INR`,
    `redirect_url=${encodeURIComponent(returnUrl)}`,
    `cancel_url=${encodeURIComponent(cancelUrl)}`,
    `language=EN`,
    `billing_name=${encodeURIComponent(name)}`,
    `billing_email=${encodeURIComponent(email || "")}`,
    `billing_tel=${encodeURIComponent(phone)}`,
    `billing_address=${encodeURIComponent("Cloud Nandy Hills, Poombarai, Kodaikanal")}`,
    `billing_city=${encodeURIComponent("Kodaikanal")}`,
    `billing_state=${encodeURIComponent("Tamil Nadu")}`,
    `billing_zip=${encodeURIComponent("624103")}`,
    `billing_country=${encodeURIComponent("India")}`,
    `merchant_param1=${encodeURIComponent(bookingId || "")}`,
    `merchant_param2=${encodeURIComponent(room)}`,
  ].join("&");

  // 3. Encrypt
  const encryptedData = ccaEncrypt(orderParams, CCAVENUE_WORKING_KEY);

  // 4. Return an auto-submitting HTML form
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Redirecting to Payment…</title>
  <style>
    body { font-family: sans-serif; display:flex; align-items:center; justify-content:center;
           min-height:100vh; background:#f0ede8; flex-direction:column; gap:16px; }
    .spinner { width:40px; height:40px; border:4px solid #f0ede8; border-top-color:#b45f3c;
               border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    p { color:#555; font-size:0.95rem; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Redirecting to secure payment gateway&hellip;</p>
  <form id="ccaForm" method="POST" action="${CCA_GATEWAY_URL}">
    <input type="hidden" name="encRequest" value="${encryptedData}" />
    <input type="hidden" name="access_code" value="${CCAVENUE_ACCESS_CODE}" />
  </form>
  <script>document.getElementById('ccaForm').submit();</script>
</body>
</html>`;

  res.set("Content-Type", "text/html");
  res.send(html);
});

/**
 * POST /api/payment/return
 * CCAvenue POSTs back here after payment.
 * Decrypts response, updates booking status in Supabase, redirects to frontend.
 */
app.post("/api/payment/return", express.urlencoded({ extended: false }), async (req, res) => {
  const encResponse = req.body.encResp;

  // Frontend URL for redirecting customer after payment
  // payment-return.html lives at root of frontend, not under /frontend/
  const PAYMENT_RETURN_BASE = "https://www.cloudynandyhills.com";

  if (!encResponse) {
    return res.redirect(
      `${PAYMENT_RETURN_BASE}/payment-return.html?status=error`
    );
  }

  let parsed = {};
  try {
    const decrypted = ccaDecrypt(encResponse, CCAVENUE_WORKING_KEY);
    parsed = parseCCAResponse(decrypted);
    console.log("CCAvenue decrypted response:", parsed);
  } catch (err) {
    console.error("CCAvenue decrypt error:", err);
    return res.redirect(
      `${PAYMENT_RETURN_BASE}/payment-return.html?status=error`
    );
  }

  const orderId      = parsed.order_id || "";
  const ccaStatus    = (parsed.order_status || "").toLowerCase(); // success / failure / aborted
  const trackingId   = parsed.tracking_id || "";
  const amount       = parsed.amount || "";
  const bookingId    = parsed.merchant_param1 || "";

  // Booking was already saved as "confirmed" at initiation.
  // On success → keep confirmed, just save the tracking ID.
  // On abort/failure → downgrade to cancelled/failed.
  let dbStatus;
  let uiStatus;
  if (ccaStatus === "success") {
    dbStatus = "confirmed"; // already confirmed — no change needed, just update tracking
    uiStatus = "success";
  } else if (ccaStatus === "aborted") {
    dbStatus = "cancelled"; // customer cancelled — downgrade
    uiStatus = "cancelled";
  } else {
    dbStatus = "cancelled"; // payment failed — downgrade (not 'failed' to keep admin clean)
    uiStatus = "failed";
  }

  // Update booking in Supabase (always save tracking_id; downgrade status if needed)
  if (orderId) {
    const updatePayload = {
      status: dbStatus,
      payment_tracking_id: trackingId || null,
    };
    const { error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("order_id", orderId);

    if (updateError) {
      console.error("Booking status update error:", updateError);
    } else {
      console.log(`Booking ${orderId} updated to ${dbStatus}`);
    }
  }

  // Redirect to frontend payment result page
  const params = new URLSearchParams({
    status: uiStatus,
    order_id: orderId,
    tracking: trackingId,
    amount,
  });

  return res.redirect(
    `${PAYMENT_RETURN_BASE}/payment-return.html?${params.toString()}`
  );
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  Cloud Nandy API running on port ${PORT}`);

  // ── Keep-alive ping (Render free tier spins down after 15 min of inactivity) ─
  // Ping our own health endpoint every 14 minutes to stay awake.
  const SELF_URL = (API_BASE_URL || "").replace(/\/$/, "");
  if (SELF_URL && !SELF_URL.includes("localhost")) {
    const https = require("https");
    const http  = require("http");
    const ping  = () => {
      const url  = `${SELF_URL}/api/health`;
      const lib  = url.startsWith("https") ? https : http;
      const req  = lib.get(url, (res) => {
        console.log(`💓 Keep-alive ping → ${url} [${res.statusCode}]`);
      });
      req.on("error", (err) => {
        console.warn("Keep-alive ping failed:", err.message);
      });
      req.end();
    };
    // First ping after 30 seconds, then every 10 minutes
    // (Render free tier spins down after 15 min — ping every 10 min stays well within)
    setTimeout(() => {
      ping();
      setInterval(ping, 10 * 60 * 1000);
    }, 30 * 1000);
    console.log(`💓 Keep-alive enabled → pinging ${SELF_URL}/api/health every 10 min`);
  }
});
