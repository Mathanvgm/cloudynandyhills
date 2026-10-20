/**
 * backend/sync/services/roomMappingService.js
 * Manages verified bidirectional mappings between Cloudnandy internal rooms
 * and external SkyHMS room types.
 */

const db = require("../db");
const auditLogger = require("../auditLogger");

class RoomMappingService {
  /**
   * Retrieve all room mappings with their status.
   */
  async getAllMappings() {
    return await db.getRoomMappings();
  }

  /**
   * Resolve an internal Cloudnandy room name or ID to a verified SkyHMS room mapping.
   * Never relies on fuzzy guessing in production: requires a verified active mapping.
   */
  async resolveInternalToExternal(roomNameOrId) {
    if (!roomNameOrId) return null;
    const mappings = await db.getRoomMappings();
    const clean = String(roomNameOrId).trim().toLowerCase();

    // Match by property_id or property_name
    const matched = mappings.find(
      (m) =>
        m.is_active &&
        ((m.property_id && String(m.property_id).trim().toLowerCase() === clean) ||
          (m.property_name && String(m.property_name).trim().toLowerCase() === clean))
    );

    if (!matched) {
      auditLogger.warn(
        "ROOM_MAPPING_NOT_FOUND",
        `No verified SkyHMS room mapping for internal room '${roomNameOrId}'.`,
        { roomNameOrId }
      );
      return null;
    }
    return matched;
  }

  /**
   * Resolve an incoming SkyHMS room type ID to a Cloudnandy property mapping.
   */
  async resolveExternalToInternal(skyHmsRoomTypeId) {
    if (!skyHmsRoomTypeId) return null;
    const mappings = await db.getRoomMappings();
    const clean = String(skyHmsRoomTypeId).trim().toUpperCase();

    const matched = mappings.find(
      (m) =>
        m.is_active &&
        m.skyhms_room_type_id &&
        m.skyhms_room_type_id.trim().toUpperCase() === clean
    );

    if (!matched) {
      auditLogger.warn(
        "EXTERNAL_ROOM_NOT_MAPPED",
        `Incoming SkyHMS room type '${skyHmsRoomTypeId}' has no verified Cloudnandy mapping. Quarantined.`,
        { skyHmsRoomTypeId }
      );
      return null;
    }
    return matched;
  }

  /**
   * Upsert a room mapping and mark it verified.
   */
  async saveMapping(mappingData) {
    if (!mappingData.skyhms_room_type_id || !mappingData.property_name) {
      throw new Error("Missing required mapping fields: skyhms_room_type_id and property_name are mandatory.");
    }

    const saved = await db.upsertRoomMapping(mappingData);
    auditLogger.info(
      "ROOM_MAPPING_SAVED",
      `Saved room mapping for '${saved.property_name}' ↔ '${saved.skyhms_room_type_id}'.`,
      saved
    );
    return saved;
  }

  /**
   * Delete or deactivate a mapping.
   */
  async deleteMapping(idOrCode) {
    const ok = await db.deleteRoomMapping(idOrCode);
    auditLogger.info("ROOM_MAPPING_DELETED", `Deleted room mapping identifier: ${idOrCode}`);
    return ok;
  }
}

module.exports = new RoomMappingService();
