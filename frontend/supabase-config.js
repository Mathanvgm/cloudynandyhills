window.CLOUD_NANDY_SUPABASE = {
  url: "https://wyjkehxbybkakgxdnoje.supabase.co",
  key: "sb_publishable_FmN54Y2I0thkiRcGsoZWzg_VSfI6Dia",
  bucket: "property-images",
  table: "properties",
};

// ── Backend API URL ──────────────────────────────────────────────────────────
window.CLOUD_NANDY_API_URL = "https://cloudnandy-1cvn.onrender.com";

if (window.supabase) {
  window.supabaseClient = window.supabase.createClient(
    window.CLOUD_NANDY_SUPABASE.url,
    window.CLOUD_NANDY_SUPABASE.key
  );
}
