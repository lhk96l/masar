-- MASAR — جداول المزامنة مع Google Sheets

-- حالة كل صف مُزامَن (المفتاح الطبيعي + بصمة المحتوى) لتفادي التكرار والتحديث غير الضروري
CREATE TABLE IF NOT EXISTS sync_state (
  sync_key    TEXT PRIMARY KEY,   -- مثل shipment:Lot-B9-25-024
  hash        TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- سجل عمليات المزامنة (للمراقبة)
CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT,
  inserted    INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  skipped     INTEGER DEFAULT 0,
  errors      INTEGER DEFAULT 0,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_synclog_created ON sync_log(created_at);
