-- MASAR — ترحيل المرحلة 2 (المحطات الزمنية + سجل التحديثات)
ALTER TABLE shipments ADD COLUMN docs_submission_date TEXT;
ALTER TABLE shipments ADD COLUMN do1_date TEXT;
ALTER TABLE shipments ADD COLUMN do2_date TEXT;
ALTER TABLE shipments ADD COLUMN do2_no TEXT;
ALTER TABLE shipments ADD COLUMN trailer_booking_date TEXT;
ALTER TABLE shipments ADD COLUMN trailer_entry_date TEXT;
ALTER TABLE shipments ADD COLUMN loading_date TEXT;
ALTER TABLE shipments ADD COLUMN releasing_date TEXT;
ALTER TABLE shipments ADD COLUMN arrival_site_date TEXT;
ALTER TABLE shipments ADD COLUMN offloading_pod_date TEXT;
ALTER TABLE shipments ADD COLUMN return_token_date TEXT;
ALTER TABLE shipments ADD COLUMN cc_receipt_date TEXT;
ALTER TABLE shipments ADD COLUMN finance_settlement_date TEXT;
ALTER TABLE shipments ADD COLUMN handover_account_date TEXT;
ALTER TABLE shipments ADD COLUMN accounting_invoice_date TEXT;
ALTER TABLE shipments ADD COLUMN latest_update TEXT;
ALTER TABLE shipments ADD COLUMN latest_update_at TEXT;

CREATE TABLE IF NOT EXISTS status_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  update_date TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_updates_shipment ON status_updates(shipment_id);
