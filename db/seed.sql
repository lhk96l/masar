-- =====================================================================
--  MASAR — بيانات أولية (Seed)
--  ملاحظة: لا يُنشأ المدير هنا. يُنشأ المدير الأول مرة واحدة عبر
--          POST /api/setup (محميّ بـ SETUP_TOKEN) لتفادي كلمات مرور ثابتة.
-- =====================================================================

INSERT OR IGNORE INTO counters (name, value) VALUES ('shipment_2026', 0);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('org_name', 'شركة عبر الشرق النفطية'),
  ('app_name', 'MASAR'),
  ('default_currency', 'USD'),
  ('setup_done', '0');
