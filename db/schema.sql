-- =====================================================================
--  MASAR  —  نظام إدارة العمليات والشحنات | شركة عبر الشرق النفطية
--  Database schema (Cloudflare D1 / SQLite)
--  Author: م. مهند المظفر — مدير قسم التكنولوجيا
--  المخطّط الكامل لكل الأقسام: لوجستك + كمارك + نقل + حسابات
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
--  المستخدمون والصلاحيات (RBAC)
--  role: admin | manager | logistics | customs | transport | accounting | viewer
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    UNIQUE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,          -- PBKDF2-SHA256 (salt:iterations:hash)
  role          TEXT    NOT NULL DEFAULT 'viewer',
  department    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0, -- إجبار تغيير كلمة المرور أول دخول
  last_login    TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- ---------------------------------------------------------------------
--  الموردون
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  country     TEXT,
  contact     TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);

-- ---------------------------------------------------------------------
--  العملاء (شركات النفط التي تخدمها الشركة) — مختلف عن المورّد
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  code        TEXT,                          -- اختصار العميل (UEG, SLB...)
  contact     TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(active);

-- ---------------------------------------------------------------------
--  الإرساليات / الشحنات  —  الكيان المحوري للنظام كله
--  status (دورة الحياة):
--    draft → opened → at_port → customs_clearance → in_transport → delivered → closed
--    (+ cancelled في أي مرحلة)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no            TEXT    NOT NULL UNIQUE,        -- MSR-2026-0001
  title             TEXT    NOT NULL,
  client_id         INTEGER REFERENCES clients(id),  -- شركة النفط المخدومة
  supplier_id       INTEGER REFERENCES suppliers(id),
  call_off          TEXT,                            -- مرجع الـ Call Off
  call_off_date     TEXT,
  importation_type  TEXT,                            -- permanent|ddp|temporary|reexport|import_license|renewal|courier
  status            TEXT    NOT NULL DEFAULT 'draft',
  priority          TEXT    NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  transport_mode    TEXT,                            -- sea | land | air
  incoterm          TEXT,                            -- FOB | CIF | CFR | EXW ...
  shipping_line     TEXT,                            -- MSC | CMA | AL RASHID ...
  shipping_agent    TEXT,                            -- الوكالة البحرية المحلية
  vessel_name       TEXT,                            -- اسم الباخرة
  voyage_no         TEXT,                            -- رقم الرحلة VOY
  vessel_ata        TEXT,                            -- الوصول الفعلي للباخرة
  berth_no          TEXT,                            -- رقم الرصيف
  origin_country    TEXT,
  origin_port       TEXT,
  destination       TEXT,
  goods_description TEXT,
  quantity          REAL,
  unit              TEXT,
  weight_kg         REAL,
  container_no      TEXT,
  bl_no             TEXT,                            -- رقم بوليصة الشحن
  currency          TEXT    DEFAULT 'USD',
  goods_value       REAL,
  etd               TEXT,                            -- موعد المغادرة المتوقع
  eta               TEXT,                            -- موعد الوصول المتوقع
  arrival_date      TEXT,                            -- تاريخ الوصول الفعلي
  delivered_date    TEXT,
  closed_date       TEXT,
  -- المحطات الزمنية (المرحلة 2)
  docs_submission_date TEXT,
  do1_date          TEXT,
  do2_date          TEXT,
  do2_no            TEXT,
  trailer_booking_date TEXT,
  trailer_entry_date TEXT,
  loading_date      TEXT,
  releasing_date    TEXT,
  arrival_site_date TEXT,
  offloading_pod_date TEXT,
  return_token_date TEXT,
  cc_receipt_date   TEXT,
  finance_settlement_date TEXT,
  handover_account_date TEXT,
  accounting_invoice_date TEXT,
  -- الحاويات والبضاعة (المرحلة 3)
  cont_20std INTEGER, cont_20fr INTEGER, cont_20ot INTEGER,
  cont_40std INTEGER, cont_40fr INTEGER, cont_40ot INTEGER,
  cont_45 INTEGER, lcl INTEGER, roro INTEGER,
  cbm REAL, total_pkgs INTEGER, packaging_type TEXT, total_trailers INTEGER,
  -- ودائع الخط الملاحي (المرحلة 3)
  sl_deposit REAL, sl_deducted REAL, sl_returned REAL,
  deposit_currency TEXT, deposit_receipt_date TEXT,
  -- إعادة التصدير (المرحلة 4)
  pre_alert_date TEXT, docs_to_org_date TEXT, exemption_approval TEXT, transit_through TEXT,
  latest_update     TEXT,
  latest_update_at  TEXT,
  notes             TEXT,
  assigned_to       INTEGER REFERENCES users(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_supplier ON shipments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_shipments_assigned ON shipments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at);

-- ---------------------------------------------------------------------
--  مستندات الشحنة (تُخزّن الملفات في R2، وهذا الجدول للبيانات الوصفية)
--  doc_type: invoice | bl | coo | packing_list | customs_decl | lc | other
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  doc_type     TEXT    NOT NULL DEFAULT 'other',
  kind         TEXT    NOT NULL DEFAULT 'file',   -- file (R2) | link (رابط خارجي مثل Drive)
  title        TEXT,
  file_name    TEXT    NOT NULL,
  r2_key       TEXT    NOT NULL DEFAULT '',
  doc_url      TEXT,                               -- للرابط الخارجي
  size_bytes   INTEGER,
  mime_type    TEXT,
  uploaded_by  INTEGER REFERENCES users(id),
  uploaded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_shipment ON shipment_documents(shipment_id);

-- ---------------------------------------------------------------------
--  البيان الكمركي (وحدة التخليص الكمركي)
--  clearance_status: pending | submitted | under_review | cleared | held
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customs_declarations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id       INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  declaration_no    TEXT,
  customs_office    TEXT,
  hs_code           TEXT,                          -- البند الجمركي (HS)
  duty_rate         REAL,                          -- نسبة الرسم %
  duty_amount       REAL,
  tax_amount        REAL,
  other_fees        REAL,
  total_fees        REAL,
  currency          TEXT DEFAULT 'USD',
  clearance_status  TEXT NOT NULL DEFAULT 'pending',
  port_arrival_date TEXT,                          -- لاحتساب الأرضيات (demurrage)
  free_days         INTEGER DEFAULT 0,
  cleared_date      TEXT,
  broker_name       TEXT,
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customs_shipment ON customs_declarations(shipment_id);
CREATE INDEX IF NOT EXISTS idx_customs_status ON customs_declarations(clearance_status);

-- ---------------------------------------------------------------------
--  عمليات الكمارك CD/LB (المرحلة 4)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customs_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abr_ref TEXT, job_type TEXT,
  client_id INTEGER REFERENCES clients(id),
  pic TEXT, operation_org TEXT, oil_company TEXT, contract_no TEXT, qty_cdlb TEXT,
  cd_no TEXT, cd_last_expire TEXT, cd_new_expire TEXT,
  lb_no TEXT, lb_last_expire TEXT, lb_new_expire TEXT,
  process_start_date TEXT, process_end_date TEXT,
  handover_to_client INTEGER DEFAULT 0, pod_signed INTEGER DEFAULT 0,
  handover_account_date TEXT, receive_account_date TEXT, invoice_client_date TEXT,
  status TEXT NOT NULL DEFAULT 'open', notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custops_status ON customs_operations(status);

-- ---------------------------------------------------------------------
--  أوامر النقل (وحدة النقل)
--  status: assigned | dispatched | in_transit | delivered | cancelled
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id       INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_no          TEXT,
  carrier           TEXT,
  truck_no          TEXT,
  driver_name       TEXT,
  driver_phone      TEXT,
  pickup_location   TEXT,
  delivery_location TEXT,
  dispatch_date     TEXT,
  delivery_date     TEXT,
  status            TEXT NOT NULL DEFAULT 'assigned',
  cost              REAL,
  currency          TEXT DEFAULT 'USD',
  booked_trailers   INTEGER,
  container_return_date TEXT,
  eir_received      INTEGER DEFAULT 0,
  in_storage        INTEGER DEFAULT 0,
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transport_shipment ON transport_orders(shipment_id);

-- ---------------------------------------------------------------------
--  الناقلون (المرحلة 3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'subcontractor',
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
--  سجل غرامات الخطوط الملاحية (المرحلة 3)
-- ---------------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_transport_status ON transport_orders(status);

-- ---------------------------------------------------------------------
--  السجلات المالية (وحدة الحسابات)
--  type: cost | invoice | payment
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id   INTEGER REFERENCES shipments(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL DEFAULT 'cost',
  category      TEXT,                              -- جمارك | نقل | شحن | تأمين | عمولة ...
  description   TEXT,
  amount        REAL    NOT NULL DEFAULT 0,
  currency      TEXT    DEFAULT 'USD',
  record_date   TEXT,
  due_date      TEXT,
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | paid | partial | overdue
  reference_no  TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_shipment ON finance_records(shipment_id);
CREATE INDEX IF NOT EXISTS idx_finance_type ON finance_records(type);
CREATE INDEX IF NOT EXISTS idx_finance_status ON finance_records(status);

-- ---------------------------------------------------------------------
--  التعليقات والتعاون على الشحنة
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id),
  body         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_shipment ON comments(shipment_id);

-- ---------------------------------------------------------------------
--  سجل تحديثات الحالة (المرحلة 2) — يحفظ السرد المؤرّخ للشحنة
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  update_date TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_updates_shipment ON status_updates(shipment_id);

-- ---------------------------------------------------------------------
--  الإشعارات
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  body         TEXT,
  link         TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ---------------------------------------------------------------------
--  سجل التدقيق (Audit Trail) — من فعل ماذا ومتى
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT    NOT NULL,                   -- create | update | delete | login | status_change ...
  entity_type  TEXT,                               -- shipment | supplier | user | document ...
  entity_id    INTEGER,
  details      TEXT,                               -- JSON أو نص
  ip           TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

-- ---------------------------------------------------------------------
--  عدّاد المرجع التسلسلي للشحنات (لكل سنة)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
--  إعدادات النظام (key/value)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
--  حدّ المحاولات (مكافحة brute-force على تسجيل الدخول)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  rl_key        TEXT PRIMARY KEY,        -- login:ip:<ip> أو login:user:<username>
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until  TEXT
);
