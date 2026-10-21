-- =============================================================================
-- Migration: 001_skyhms_sync_schema.sql
-- Description: Inventory Synchronization Schema for Cloudnandy Resort & SkyHMS
-- Author: VGM SOFT TECH
-- Property: Cloudnandy Resort, Poombarai, Kodaikanal
-- =============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Room Mapping Table
-- Maps Cloudnandy properties/rooms to SkyHMS Room Type codes
CREATE TABLE IF NOT EXISTS skyhms_room_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id TEXT NOT NULL,
    property_name TEXT NOT NULL,
    skyhms_room_type_id TEXT NOT NULL,
    skyhms_room_type_name TEXT,
    rate_plan_id TEXT DEFAULT 'STANDARD',
    total_inventory INTEGER NOT NULL DEFAULT 1 CHECK (total_inventory >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    sync_mode TEXT NOT NULL DEFAULT 'two_way' CHECK (sync_mode IN ('two_way', 'push_only', 'pull_only')),
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_skyhms_room_type UNIQUE (skyhms_room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_skyhms_room_mappings_prop ON skyhms_room_mappings(property_id);
CREATE INDEX IF NOT EXISTS idx_skyhms_room_mappings_name ON skyhms_room_mappings(property_name);

-- 2. Reservation Mapping Table
-- Tracks reservations from both sources to maintain a shared ledger and avoid sync loops
CREATE TABLE IF NOT EXISTS skyhms_reservation_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_booking_id TEXT,
    internal_order_id TEXT NOT NULL,
    skyhms_reservation_id TEXT,
    skyhms_confirmation_no TEXT,
    room_name TEXT NOT NULL,
    skyhms_room_type_id TEXT,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    origin TEXT NOT NULL DEFAULT 'CUSTOM_ENGINE' CHECK (origin IN ('CUSTOM_ENGINE', 'SKYHMS', 'ADMIN', 'CHANNEL_MANAGER')),
    sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'failed', 'cancelled', 'reconciled')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    payload JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_internal_order_id UNIQUE (internal_order_id)
);

CREATE INDEX IF NOT EXISTS idx_skyhms_res_mappings_sky_id ON skyhms_reservation_mappings(skyhms_reservation_id);
CREATE INDEX IF NOT EXISTS idx_skyhms_res_mappings_dates ON skyhms_reservation_mappings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_skyhms_res_mappings_status ON skyhms_reservation_mappings(sync_status);

-- 3. Inbound Sync Events Table (Deduplication & Webhook idempotency)
CREATE TABLE IF NOT EXISTS skyhms_sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'ignored', 'failed', 'pending')),
    payload JSONB,
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_skyhms_event_id UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_skyhms_events_received ON skyhms_sync_events(received_at DESC);

-- 4. Audit Log Table (Detailed integration logs)
CREATE TABLE IF NOT EXISTS skyhms_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skyhms_logs_created ON skyhms_sync_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skyhms_logs_level ON skyhms_sync_logs(level);

-- 5. Sync Configuration Table (Key-value config store)
CREATE TABLE IF NOT EXISTS skyhms_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default configuration entries
INSERT INTO skyhms_config (key, value) VALUES
('sync_enabled', 'true'::jsonb),
('dry_run_mode', 'false'::jsonb),
('sync_interval_minutes', '15'::jsonb),
('max_retries', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 6. Add origin column and external ID to bookings table if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bookings' AND column_name = 'origin'
    ) THEN
        ALTER TABLE bookings ADD COLUMN origin TEXT DEFAULT 'CUSTOM_ENGINE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bookings' AND column_name = 'skyhms_reservation_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN skyhms_reservation_id TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bookings' AND column_name = 'skyhms_sync_status'
    ) THEN
        ALTER TABLE bookings ADD COLUMN skyhms_sync_status TEXT DEFAULT 'pending';
    END IF;
END $$;

-- 7. Seed Default Verified Room Mappings for Cloudy Nandy Hills (bkgpropid: 1035)
INSERT INTO skyhms_room_mappings (property_id, property_name, skyhms_room_type_id, skyhms_room_type_name, rate_plan_id, total_inventory, is_active, sync_mode)
VALUES 
('c6f442bf-f465-40f2-9e91-96d5f18a27ad', 'Mountain Cabin', 'MCB', 'Mountain View', 'STD (CP)', 2, true, 'two_way'),
('5a1dfa4b-2b63-4e0a-b923-f3856622f709', 'Deluxe Mountain View', 'DMV', 'Dlx Mountain View', 'STD (CP)', 3, true, 'two_way'),
('e2c04731-8e24-4a0c-9cb5-5353ad448900', 'Superior Afram Cabin (Superior Afram)', 'SFV', 'Superior Afram Cabin With Mountain View', 'STD (CP)', 2, true, 'two_way'),
('1f88ab32-524d-47e5-8ce7-a2f9fd02e230', 'WOODEN CABIN TWO BEDROOM (Dlx Wooden House)', 'DTWH', 'Wooden Cabin With Two Bedroom', 'STD (CP)', 1, true, 'two_way'),
('436ae43c-e4e8-4ac1-9f9f-9e3b2a1920e4', 'Premium Family Cabin  Mountain View', 'DDM', 'Premium Room With Mountain View', 'STD (CP)', 2, true, 'two_way')
ON CONFLICT (skyhms_room_type_id) DO UPDATE SET
    property_id = EXCLUDED.property_id,
    property_name = EXCLUDED.property_name,
    skyhms_room_type_name = EXCLUDED.skyhms_room_type_name,
    rate_plan_id = EXCLUDED.rate_plan_id,
    last_verified_at = now(),
    updated_at = now();
