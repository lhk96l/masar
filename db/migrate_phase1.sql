-- MASAR — ترحيل المرحلة 1 (العميل + حقول الشحن + روابط المستندات)
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  contact TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(active);

ALTER TABLE shipments ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE shipments ADD COLUMN call_off TEXT;
ALTER TABLE shipments ADD COLUMN call_off_date TEXT;
ALTER TABLE shipments ADD COLUMN importation_type TEXT;
ALTER TABLE shipments ADD COLUMN shipping_line TEXT;
ALTER TABLE shipments ADD COLUMN shipping_agent TEXT;
ALTER TABLE shipments ADD COLUMN vessel_name TEXT;
ALTER TABLE shipments ADD COLUMN voyage_no TEXT;
ALTER TABLE shipments ADD COLUMN vessel_ata TEXT;
ALTER TABLE shipments ADD COLUMN berth_no TEXT;
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_id);

ALTER TABLE shipment_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE shipment_documents ADD COLUMN doc_url TEXT;
