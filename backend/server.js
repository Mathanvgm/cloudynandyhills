require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const { initSkyHmsSync, inventorySyncService, reservationSyncService } = require("./sync");

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
  // Email (Gmail SMTP) — set these in Render env vars
  EMAIL_USER,    // your Gmail address e.g. stay@cloudnandyhills.com
  EMAIL_PASS,    // Gmail App Password (not your regular password)
  EMAIL_FROM = "Cloud Nandy Hills <stay@cloudnandyhills.com>",
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
const API_BASE_URL     = BACKEND_URL  || "https://cloudynandyhills.onrender.com";
const UI_BASE_URL      = FRONTEND_URL || "https://www.cloudynandyhills.com";

// ── Hard-coded production URLs — CCAvenue callback MUST use these exact URLs ──
// These are fixed so a misconfigured BACKEND_URL env var can never break payments.
// CCAvenue MUST post back to the Render API (backend), not the website frontend.
const CCA_REDIRECT_DOMAIN = "https://cloudynandyhills.onrender.com";
// After payment completes, customer is sent to this page on the live website.
const PAYMENT_RETURN_BASE = "https://www.cloudynandyhills.com";

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
} else {
  const fallbackUrl = SUPABASE_URL || "https://wyjkehxbybkakgxdnoje.supabase.co";
  console.warn("⚠️  SUPABASE_SERVICE_KEY missing. Initializing in local dev mode (SkyHMS in-memory/SQLite active).");
  supabase = createClient(fallbackUrl, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dev_placeholder", {
    auth: { persistSession: false },
  });
}

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow any origin: website (www or non-www), file:// protocol, localhost, etc.
      callback(null, true);
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

// ─── Email Helper ─────────────────────────────────────────────────────────────

/**
 * Send booking confirmation email to guest.
 * Requires EMAIL_USER and EMAIL_PASS env vars (Gmail App Password).
 * Silently skips if credentials are not set or guest has no email.
 */
async function sendBookingEmail({ name, email, phone, room, check_in, check_out, adults, children, amount, orderId, tracking }) {
  if (!EMAIL_USER || !EMAIL_PASS || !email) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const fmt = (d) => d ? d.split("-").reverse().join(" ") : "—";
  const fmtAmt = (v) => v ? "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede8;padding:32px 16px">
<tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
    <!-- Header -->
    <tr><td style="background:#17211d;border-radius:16px 16px 0 0;padding:24px 32px">
      <span style="font-size:20px;font-weight:800;color:#fff">&#9729; Cloud Nandy Hills</span><br>
      <span style="font-size:13px;color:#9ca3af">Poombarai, Kodaikanal &middot; Tamil Nadu</span>
    </td></tr>
    <!-- Green Banner -->
    <tr><td style="background:#16a34a;padding:20px 32px;text-align:center">
      <div style="font-size:32px">&#10003;</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-top:6px">Booking Confirmed!</div>
      <div style="font-size:13px;color:#dcfce7;margin-top:6px">Your stay is secured. We look forward to welcoming you!</div>
    </td></tr>
    <!-- Body -->
    <tr><td style="background:#fff;padding:28px 32px">
      <p style="color:#374151;font-size:15px;margin:0 0 20px">Dear <strong>${name}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin:0 0 24px;line-height:1.6">
        Your booking at Cloud Nandy Hills has been <strong style="color:#16a34a">confirmed</strong>.
        Your booking reference is <strong>${orderId}</strong>. Please save this email for your records.
      </p>
      <!-- Details Table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px">
        <tr style="background:#f9fafb"><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Booking Reference</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${orderId}</td></tr>
        <tr><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Room / Cabin</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${room}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Check-In</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${fmt(check_in)} at 1:00 PM</td></tr>
        <tr><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Check-Out</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${fmt(check_out)} at 11:00 AM</td></tr>
        <tr style="background:#f9fafb"><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Guests</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${adults || 1} Adult${(adults || 1) > 1 ? "s" : ""}${children > 0 ? ", " + children + " Child" : ""}</td></tr>
        <tr><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb">Amount Paid</td><td style="padding:11px 16px;font-size:13px;color:#16a34a;font-weight:700;text-align:right;border-bottom:1px solid #e5e7eb">${fmtAmt(amount)}</td></tr>
        ${tracking ? `<tr style="background:#f9fafb"><td style="padding:11px 16px;font-size:13px;color:#6b7280;font-weight:500">Tracking ID</td><td style="padding:11px 16px;font-size:13px;color:#1a1a1a;font-weight:700;text-align:right">${tracking}</td></tr>` : ""}
      </table>
      <!-- Policies -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;border-left:3px solid #b45f3c;border-radius:0 8px 8px 0;margin-bottom:24px">
        <tr><td style="padding:14px 16px;font-size:13px;color:#7a4a2c;line-height:1.6">
          <strong>Property Policies</strong><br>
          &bull; Check-in: 1:00 PM &nbsp;&nbsp; Check-out: 11:00 AM<br>
          &bull; Please carry a valid government-issued photo ID at check-in.<br>
          &bull; Our team will contact you at <strong>${phone}</strong> with arrival details.
        </td></tr>
      </table>
      <p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6">
        For any queries, contact us at <a href="tel:+919095744759" style="color:#b45f3c;text-decoration:none">090957 44759</a> or reply to this email.
      </p>
    </td></tr>
    <!-- Footer -->
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center">
      <p style="color:#9ca3af;font-size:12px;margin:0">
        Cloud Nandy Hills &nbsp;&middot;&nbsp; No.5/166, Kochakanal Street, Poombarai, Kodaikanal, Tamil Nadu 624103<br>
        <a href="https://www.cloudynandyhills.com" style="color:#b45f3c;text-decoration:none">www.cloudynandyhills.com</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: `Booking Confirmed – ${room} | Cloud Nandy Hills (${orderId})`,
      html,
    });
    console.log(`✉ Confirmation email sent to ${email} for booking ${orderId}`);
  } catch (err) {
    console.error("Email send error:", err.message);
    // Non-fatal — don't break the payment flow
  }
}



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
    version: "1.1.0",
    endpoints: [
      "/api/health",
      "/api/properties",
      "/api/bookings",
      "/api/payment/initiate",
      "/api/skyhms/status",
      "/api/skyhms/availability",
      "/api/skyhms/mappings",
      "/api/skyhms/webhook"
    ],
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

  // ── SkyHMS & Local Availability Check ──
  try {
    const avail = await inventorySyncService.checkAvailability({
      roomName: room,
      checkIn: check_in,
      checkOut: check_out,
      requestedRooms: 1,
    });

    if (!avail.isAvailable) {
      return sendError(res, 409, avail.reason || "The selected cabin is not available for these dates.");
    }
  } catch (availErr) {
    console.warn("Availability pre-check warning:", availErr.message);
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

  // Non-blocking sync to SkyHMS
  reservationSyncService.syncWebsiteBookingToSkyHms({
    id: bookingId,
    order_id: orderId,
    room,
    check_in,
    check_out,
    name,
    email,
    phone,
    adults,
    children,
    total_amount,
    requests,
    origin: "CUSTOM_ENGINE",
  }).catch((syncErr) => console.error("SkyHMS sync fire error:", syncErr.message));

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
  const {
    name, email, phone, room,
    check_in, check_out, adults, children,
    requests, total_amount, frontend_origin,
  } = req.body || {};

  if (!name || !phone || !room || !check_in || !check_out || !total_amount) {
    return sendError(res, 400, "Missing required booking fields.");
  }

  const frontendOrigin = (frontend_origin || req.headers.origin || FRONTEND_URL || "https://www.cloudynandyhills.com").replace(/\/$/, "");

  // ── SkyHMS & Local Concurrency Check: Prevent Double Bookings ──
  try {
    const avail = await inventorySyncService.checkAvailability({
      roomName: room,
      checkIn: check_in,
      checkOut: check_out,
      requestedRooms: 1,
    });

    if (!avail.isAvailable) {
      console.warn(`[DOUBLE-BOOKING-PREVENTED] Room '${room}' is unavailable for ${check_in} to ${check_out}`);
      return sendError(res, 409, avail.reason || "The selected cabin is already booked for these dates.");
    }
  } catch (availErr) {
    console.warn("Availability pre-check warning:", availErr.message);
  }

  // Generate a unique order ID
  const orderId = "CNH-" + Date.now() + "-" + Math.floor(Math.random() * 9000 + 1000);

  // 1. Save booking as PENDING in Supabase.
  //    Only when payment is confirmed in /api/payment/return is it upgraded to 'confirmed' and pushed to SkyHMS.
  //    If payment fails, is cancelled, or the user navigates away, the room is moved to 'cancelled'.
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
      status: "pending",
      order_id: orderId,
      booked_at: new Date().toISOString(),
    }])
    .select("id");

  if (insertError) {
    console.error("Booking insert error:", insertError);
    return sendError(res, 500, "Failed to create booking: " + insertError.message);
  }

  const bookingId = insertedRows && insertedRows[0] ? insertedRows[0].id : null;

  const hasLiveCca = CCAVENUE_MERCHANT_ID && CCAVENUE_ACCESS_CODE && CCAVENUE_WORKING_KEY;

  if (hasLiveCca) {
    // 2. Build live CCAvenue order params string
    const returnUrl = `${CCA_REDIRECT_DOMAIN.replace(/\/$/, "")}/api/payment/return`;
    const cancelUrl = `${CCA_REDIRECT_DOMAIN.replace(/\/$/, "")}/api/payment/return?status=cancelled&order_id=${orderId}&frontend_origin=${encodeURIComponent(frontendOrigin)}`;

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
      `merchant_param3=${encodeURIComponent(frontendOrigin)}`,
    ].join("&");

    // Encrypt & Return auto-submitting CCAvenue HTML form
    const encryptedData = ccaEncrypt(orderParams, CCAVENUE_WORKING_KEY);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Redirecting to Payment…</title>
  <style>
    body { font-family: sans-serif; display:flex; align-items:center; justify-content:center;
           min-height:100vh; background:#08110e; color:#fff; flex-direction:column; gap:16px; }
    .spinner { width:40px; height:40px; border:4px solid rgba(255,255,255,0.1); border-top-color:#b45f3c;
               border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    p { color:#94a3b8; font-size:0.95rem; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Connecting to CCAvenue secure gateway&hellip;</p>
  <form id="ccaForm" method="POST" action="${CCA_GATEWAY_URL}">
    <input type="hidden" name="encRequest" value="${encryptedData}" />
    <input type="hidden" name="access_code" value="${CCAVENUE_ACCESS_CODE}" />
  </form>
  <script>document.getElementById('ccaForm').submit();</script>
</body>
</html>`;

    res.set("Content-Type", "text/html");
    return res.send(html);
  }

  // 3. Fallback Test/Simulation Gateway (activates when CCAvenue keys are not set on environment)
  const simHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Secure Payment Checkout | Cloud Nandy Hills</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #08110e; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .checkout-box { background: #13221b; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; max-width: 480px; width: 100%; padding: 36px 30px; box-shadow: 0 25px 80px rgba(0,0,0,0.6); text-align: center; }
    .badge { display: inline-block; background: rgba(180,95,60,0.2); border: 1px solid rgba(180,95,60,0.4); color: #e5b869; font-size: 0.72rem; font-weight: 800; padding: 5px 14px; border-radius: 999px; letter-spacing: 0.06em; margin-bottom: 16px; text-transform: uppercase; }
    h2 { font-family: 'Outfit', sans-serif; font-size: 1.6rem; font-weight: 800; margin-bottom: 6px; color: #fff; }
    .subtitle { color: #94a3b8; font-size: 0.88rem; line-height: 1.5; margin-bottom: 24px; }
    .invoice-card { background: #0b1612; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 18px 20px; margin-bottom: 26px; text-align: left; font-size: 0.88rem; }
    .inv-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .inv-row:last-child { border-bottom: none; padding-top: 12px; margin-top: 4px; }
    .lbl { color: #94a3b8; font-weight: 500; }
    .val { color: #fff; font-weight: 600; text-align: right; }
    .val.amount { color: #34d399; font-size: 1.15rem; font-weight: 800; }
    .actions-wrap { display: flex; flex-direction: column; gap: 12px; }
    .btn { width: 100%; padding: 15px; border-radius: 12px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.96rem; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; }
    .btn-success { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; box-shadow: 0 4px 18px rgba(16,185,129,0.35); }
    .btn-success:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(16,185,129,0.5); }
    .btn-cancel { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); color: #fca5a5; }
    .btn-cancel:hover { background: rgba(239,68,68,0.22); transform: translateY(-1px); }
  </style>
</head>
<body>
  <div class="checkout-box">
    <div class="badge">CCAvenue Gateway Checkout</div>
    <h2>Confirm Your Stay</h2>
    <p class="subtitle">Cloud Nandy Hills Luxury Cabins &middot; Poombarai, Kodaikanal</p>
    <div class="invoice-card">
      <div class="inv-row"><span class="lbl">Guest Name</span><span class="val">${name}</span></div>
      <div class="inv-row"><span class="lbl">Cabin</span><span class="val">${room}</span></div>
      <div class="inv-row"><span class="lbl">Stay Dates</span><span class="val">${check_in} &rarr; ${check_out}</span></div>
      <div class="inv-row"><span class="lbl">Order ID</span><span class="val"><code style="color:#e5b869;">${orderId}</code></span></div>
      <div class="inv-row"><span class="lbl">Total Payable</span><span class="val amount">₹${Number(total_amount).toLocaleString("en-IN")}</span></div>
    </div>
    <div class="actions-wrap">
      <form method="POST" action="${API_BASE_URL}/api/payment/simulate">
        <input type="hidden" name="order_id" value="${orderId}"/>
        <input type="hidden" name="action" value="success"/>
        <input type="hidden" name="amount" value="${total_amount}"/>
        <input type="hidden" name="frontend_origin" value="${frontendOrigin}"/>
        <button type="submit" class="btn btn-success">✓ Authorize Payment (₹${Number(total_amount).toLocaleString("en-IN")})</button>
      </form>
      <form method="POST" action="${API_BASE_URL}/api/payment/simulate">
        <input type="hidden" name="order_id" value="${orderId}"/>
        <input type="hidden" name="action" value="cancelled"/>
        <input type="hidden" name="frontend_origin" value="${frontendOrigin}"/>
        <button type="submit" class="btn btn-cancel">✕ Cancel / Decline Payment</button>
      </form>
    </div>
  </div>
</body>
</html>`;

  res.set("Content-Type", "text/html");
  res.send(simHtml);
});

/**
 * POST /api/payment/simulate
 * Handles simulated gateway authorization or cancellation when in sandbox/demo mode.
 */
app.post("/api/payment/simulate", express.urlencoded({ extended: false }), async (req, res) => {
  const { order_id, action, amount, frontend_origin } = req.body || {};
  const returnBase = (frontend_origin || FRONTEND_URL || "https://www.cloudynandyhills.com").replace(/\/$/, "");

  const isSuccess = action === "success";
  const trackingId = isSuccess ? "SIM_" + Date.now() : "";
  const dbStatus = isSuccess ? "confirmed" : "cancelled";
  const uiStatus = isSuccess ? "success" : "cancelled";

  if (order_id && supabase) {
    try {
      await supabase
        .from("bookings")
        .update({
          status: dbStatus,
          payment_tracking_id: trackingId || "CANCELLED_BY_USER",
        })
        .eq("order_id", order_id);

      console.log(`[PAYMENT-SIMULATE] Booking ${order_id} updated to ${dbStatus}`);

      if (isSuccess) {
        const { data: bookingRows } = await supabase
          .from("bookings")
          .select("id,name,email,phone,room,check_in,check_out,adults,children,total_amount")
          .eq("order_id", order_id)
          .limit(1);

        if (bookingRows && bookingRows[0]) {
          const b = bookingRows[0];
          sendBookingEmail({
            name: b.name,
            email: b.email,
            phone: b.phone,
            room: b.room,
            check_in: b.check_in,
            check_out: b.check_out,
            adults: b.adults,
            children: b.children,
            amount: amount || b.total_amount,
            orderId: order_id,
            tracking: trackingId,
          }).catch((err) => console.error("Simulated email error:", err.message));

          reservationSyncService.syncWebsiteBookingToSkyHms({
            id: b.id,
            order_id,
            name: b.name,
            email: b.email,
            phone: b.phone,
            room: b.room,
            check_in: b.check_in,
            check_out: b.check_out,
            adults: b.adults,
            children: b.children,
            total_amount: amount || b.total_amount,
            origin: "CUSTOM_ENGINE",
          }).catch((syncErr) => console.error("SkyHMS auto-sync error:", syncErr.message));
        }
      }
    } catch (dbErr) {
      console.error("Payment simulate error:", dbErr.message);
    }
  }

  const queryParams = new URLSearchParams({
    status: uiStatus,
    order_id: order_id || "",
    tracking: trackingId,
    amount: amount || "",
  });

  return res.redirect(`${returnBase}/payment-return.html?${queryParams.toString()}`);
});

/**
 * POST /api/payment/return
 * CCAvenue POSTs back here after payment.
 * Decrypts response, updates booking status in Supabase, redirects to frontend.
 */
app.post("/api/payment/return", express.urlencoded({ extended: false }), async (req, res) => {
  const encResponse = req.body.encResp;

  let parsed = {};
  if (encResponse && CCAVENUE_WORKING_KEY) {
    try {
      const decrypted = ccaDecrypt(encResponse, CCAVENUE_WORKING_KEY);
      parsed = parseCCAResponse(decrypted);
      console.log("CCAvenue decrypted response:", parsed);
    } catch (err) {
      console.error("CCAvenue decrypt error:", err);
    }
  }

  const orderId = parsed.order_id || req.body.order_id || "";
  const ccaStatus = (parsed.order_status || req.body.status || "").toLowerCase(); // success / failure / aborted
  const trackingId = parsed.tracking_id || "";
  const amount = parsed.amount || "";
  const frontendOrigin = parsed.merchant_param3 || req.body.frontend_origin;
  const returnBase = (frontendOrigin || FRONTEND_URL || "https://www.cloudynandyhills.com").replace(/\/$/, "");

  let dbStatus;
  let uiStatus;
  if (ccaStatus === "success") {
    dbStatus = "confirmed";
    uiStatus = "success";
  } else if (ccaStatus === "aborted") {
    dbStatus = "cancelled";
    uiStatus = "cancelled";
  } else {
    dbStatus = "cancelled";
    uiStatus = "failed";
  }

  if (orderId && supabase) {
    const updatePayload = {
      status: dbStatus,
      payment_tracking_id: trackingId || (ccaStatus === "success" ? "PAID" : "CANCELLED_OR_FAILED"),
    };

    const { error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("order_id", orderId);

    if (updateError) {
      console.error("Booking status update error:", updateError);
    } else {
      console.log(`Booking ${orderId} updated to ${dbStatus} in Supabase`);
    }

    if (ccaStatus === "success") {
      const { data: bookingRows } = await supabase
        .from("bookings")
        .select("id,name,email,phone,room,check_in,check_out,adults,children,total_amount")
        .eq("order_id", orderId)
        .limit(1);

      if (bookingRows && bookingRows[0]) {
        const b = bookingRows[0];
        sendBookingEmail({
          name: b.name,
          email: b.email,
          phone: b.phone,
          room: b.room,
          check_in: b.check_in,
          check_out: b.check_out,
          adults: b.adults,
          children: b.children,
          amount: amount || b.total_amount,
          orderId,
          tracking: trackingId,
        }).catch((err) => console.error("Email fire error:", err.message));

        reservationSyncService.syncWebsiteBookingToSkyHms({
          id: b.id,
          order_id: orderId,
          name: b.name,
          email: b.email,
          phone: b.phone,
          room: b.room,
          check_in: b.check_in,
          check_out: b.check_out,
          adults: b.adults,
          children: b.children,
          total_amount: amount || b.total_amount,
          origin: "CUSTOM_ENGINE",
        }).catch((syncErr) => console.error("SkyHMS auto-sync fire error:", syncErr.message));
      }
    }
  }

  const params = new URLSearchParams({
    status: uiStatus,
    order_id: orderId,
    tracking: trackingId,
    amount,
  });

  return res.redirect(`${returnBase}/payment-return.html?${params.toString()}`);
});

/**
 * GET /api/payment/return
 * Handles customer cancellation / browser return from CCAvenue cancel_url via GET.
 * Immediately marks booking as 'cancelled' so the room is released for booking.
 */
app.get("/api/payment/return", async (req, res) => {
  const orderId = req.query.order_id || "";
  const statusParam = (req.query.status || "cancelled").toLowerCase();
  const returnBase = (req.query.frontend_origin || FRONTEND_URL || "https://www.cloudynandyhills.com").replace(/\/$/, "");

  if (orderId && supabase) {
    try {
      const { data: existing } = await supabase
        .from("bookings")
        .select("status")
        .eq("order_id", orderId)
        .maybeSingle();

      if (existing && existing.status !== "confirmed") {
        await supabase
          .from("bookings")
          .update({ status: "cancelled", payment_tracking_id: "CANCELLED_BY_USER" })
          .eq("order_id", orderId);
        console.log(`[PAYMENT-CANCEL] Booking ${orderId} cancelled via customer return GET.`);
      }
    } catch (err) {
      console.warn("Cancel GET booking update error:", err.message);
    }
  }

  const params = new URLSearchParams({
    status: statusParam === "cancelled" ? "cancelled" : "failed",
    order_id: orderId,
  });

  return res.redirect(`${returnBase}/payment-return.html?${params.toString()}`);
});

/**
 * POST /api/payment/cancel
 * Allows frontend to explicitly release a pending booking hold if the user cancels or closes checkout.
 */
app.post("/api/payment/cancel", async (req, res) => {
  const { order_id } = req.body || {};
  if (!order_id) {
    return sendError(res, 400, "order_id is required.");
  }
  if (supabase) {
    await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("order_id", order_id)
      .neq("status", "confirmed");
  }
  res.json({ ok: true, message: "Booking cancelled and room released." });
});

// ── Initialize SkyHMS Inventory Synchronization Subsystem ──────────────────
try {
  initSkyHmsSync(app, supabase);
  console.log("✅  SkyHMS Inventory Synchronization Subsystem initialized");
} catch (syncInitErr) {
  console.error("❌  SkyHMS sync initialization error:", syncInitErr.message);
}

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  Cloud Nandy API running on port ${PORT}`);

  // ── Auto-cleanup expired pending payment holds (15 min timeout) ─────────────
  // If payment was not done or the customer returned to any other page / closed tab,
  // automatically release the room so other guests can book it.
  const cleanupExpiredPendingBookings = async () => {
    if (!supabase) return;
    try {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: expired, error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("status", "pending")
        .lt("booked_at", fifteenMinsAgo)
        .select("id, order_id, room");

      if (!error && expired && expired.length > 0) {
        console.log(`🧹 Auto-released ${expired.length} abandoned pending booking(s): rooms are free.`);
      }
    } catch (err) {
      console.warn("Expired pending bookings cleanup warning:", err.message);
    }
  };
  cleanupExpiredPendingBookings();
  setInterval(cleanupExpiredPendingBookings, 5 * 60 * 1000);

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
