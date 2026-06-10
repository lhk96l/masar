-- MASAR — سجل تغييرات المزامنة (من أضاف/عدّل ماذا بالتفصيل)
CREATE TABLE IF NOT EXISTS change_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT,                 -- shipment | customs_op | penalty | transport
  entity_id     INTEGER,
  ref_no        TEXT,                  -- رقم الشحنة/المرجع للعرض
  action        TEXT,                  -- insert | update
  pic           TEXT,                  -- المسؤول (من ملف الـ DSR)
  changed_fields TEXT,                 -- JSON: {field:{old,new}}
  source        TEXT,                  -- اسم الملف/التبويب
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_changelog_created ON change_log(created_at);
CREATE INDEX IF NOT EXISTS idx_changelog_entity ON change_log(entity_type, entity_id);
