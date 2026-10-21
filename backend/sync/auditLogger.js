/**
 * backend/sync/auditLogger.js
 * Structured logging and persistence for synchronization audit trail.
 */

const inMemoryLogs = [];
const MAX_IN_MEMORY_LOGS = 200;

class AuditLogger {
  constructor() {
    this.supabaseClient = null;
  }

  setClient(client) {
    this.supabaseClient = client;
  }

  async _log(level, action, message, details = null) {
    const timestamp = new Date().toISOString();
    let safeDetails = details;
    if (details && typeof details === "object") {
      try {
        safeDetails = JSON.parse(JSON.stringify(details));
      } catch (e) {
        safeDetails = String(details);
      }
    }

    const entry = {
      level,
      action,
      message,
      details: safeDetails,
      created_at: timestamp,
    };

    // Formatted console output
    const icon = {
      debug: "🔍",
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
    }[level] || "📝";

    let detailsStr = "";
    if (safeDetails) {
      try {
        detailsStr = ` | ${typeof safeDetails === "string" ? safeDetails : JSON.stringify(safeDetails)}`;
      } catch (e) {
        detailsStr = ` | [Unserializable Details]`;
      }
    }
    console.log(`${icon} [SkyHMS-Sync] [${level.toUpperCase()}] [${action}] ${message}${detailsStr}`);

    // Buffer in memory
    inMemoryLogs.unshift(entry);
    if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
      inMemoryLogs.pop();
    }

    // Try saving to database asynchronously if client available
    if (this.supabaseClient) {
      try {
        await this.supabaseClient.from("skyhms_sync_logs").insert([{
          level,
          action,
          message,
          details: details ? (typeof details === "object" ? details : { raw: details }) : null,
          created_at: timestamp,
        }]);
      } catch (err) {
        // Silent fail to not disrupt primary process if table not yet migrated
      }
    }

    return entry;
  }

  debug(action, message, details) {
    return this._log("debug", action, message, details);
  }

  info(action, message, details) {
    return this._log("info", action, message, details);
  }

  warn(action, message, details) {
    return this._log("warn", action, message, details);
  }

  error(action, message, details) {
    return this._log("error", action, message, details);
  }

  getRecentLogs(limit = 50, level = null) {
    let filtered = inMemoryLogs;
    if (level && level !== "all") {
      filtered = filtered.filter((l) => l.level === level.toLowerCase());
    }
    return filtered.slice(0, limit);
  }

  clearInMemory() {
    inMemoryLogs.length = 0;
  }
}

module.exports = new AuditLogger();
