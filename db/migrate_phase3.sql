-- MASAR — ترحيل المرحلة 3 (الحاويات + النقل المتقدّم + الودائع والغرامات)

-- أعداد الحاويات والبضاعة على الشحنة
ALTER TABLE shipments ADD COLUMN cont_20std INTEGER;
ALTER TABLE shipments ADD COLUMN cont_20fr INTEGER;
ALTER TABLE shipments ADD COLUMN cont_20ot INTEGER;
ALTER TABLE shipments ADD COLUMN cont_40std INTEGER;
ALTER TABLE shipments ADD COLUMN cont_40fr INTEGER;
ALTER TABLE shipments ADD COLUMN cont_40ot INTEGER;
ALTER TABLE shipments ADD COLUMN cont_45 INTEGER;
ALTER TABLE shipments ADD COLUMN lcl INTEGER;
ALTER TABLE shipments ADD COLUMN roro INTEGER;
ALTER TABLE shipments ADD COLUMN cbm REAL;
ALTER TABLE shipments ADD COLUMN total_pkgs INTEGER;
ALTER TABLE shipments ADD COLUMN packaging_type TEXT;
ALTER TABLE shipments ADD COLUMN total_trailers INTEGER;

-- ودائع الخط الملاحي على الشحنة
ALTER TABLE shipments ADD COLUMN sl_deposit REAL;
ALTER TABLE shipments ADD COLUMN sl_deducted REAL;
ALTER TABLE shipments ADD COLUMN sl_returned REAL;
ALTER TABLE shipments ADD COLUMN deposit_currency TEXT;
ALTER TABLE shipments ADD COLUMN deposit_receipt_date TEXT;

-- الناقلون
CREATE TABLE IF NOT EXISTS carriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'subcontractor',   -- own (سيارات عبر الشرق) | subcontractor
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- حقول إضافية لأوامر النقل
ALTER TABLE transport_orders ADD COLUMN booked_trailers INTEGER;
ALTER TABLE transport_orders ADD COLUMN container_return_date TEXT;
ALTER TABLE transport_orders ADD COLUMN eir_received INTEGER DEFAULT 0;
ALTER TABLE transport_orders ADD COLUMN in_storage INTEGER DEFAULT 0;

-- سجل غرامات الخطوط الملاحية
CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
  shipment_ref TEXT,
  client TEXT,
  shipping_line TEXT,
  agent TEXT,
  type_of_entry TEXT,
  penalty_amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'IQD',
  do_receipt INTEGER DEFAULT 0,
  submission_date TEXT,
  pic TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_penalties_shipment ON penalties(shipment_id);
