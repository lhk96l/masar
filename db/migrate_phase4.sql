-- MASAR — ترحيل المرحلة 4 (عمليات الكمارك CD/LB + إعادة التصدير)

-- حقول إعادة التصدير على الشحنة
ALTER TABLE shipments ADD COLUMN pre_alert_date TEXT;
ALTER TABLE shipments ADD COLUMN docs_to_org_date TEXT;
ALTER TABLE shipments ADD COLUMN exemption_approval TEXT;
ALTER TABLE shipments ADD COLUMN transit_through TEXT;

-- وحدة عمليات الكمارك (إدارة المستندات الكمركية CD والكفالات LB)
CREATE TABLE IF NOT EXISTS customs_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abr_ref TEXT,                         -- الرقم المرجعي الرئيسي ABR
  job_type TEXT,                        -- نوع العملية (CD / LB / تجديد...)
  client_id INTEGER REFERENCES clients(id),
  pic TEXT,                             -- المسؤول
  operation_org TEXT,                   -- جهة العملية (Operation Organisation)
  oil_company TEXT,                     -- الشركة النفطية
  contract_no TEXT,
  qty_cdlb TEXT,                        -- عدد CD/LB
  cd_no TEXT,
  cd_last_expire TEXT,
  cd_new_expire TEXT,
  lb_no TEXT,
  lb_last_expire TEXT,
  lb_new_expire TEXT,
  process_start_date TEXT,
  process_end_date TEXT,
  handover_to_client INTEGER DEFAULT 0,
  pod_signed INTEGER DEFAULT 0,
  handover_account_date TEXT,
  receive_account_date TEXT,
  invoice_client_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open | in_progress | done
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custops_status ON customs_operations(status);
CREATE INDEX IF NOT EXISTS idx_custops_client ON customs_operations(client_id);
