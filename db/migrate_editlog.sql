-- MASAR — سجل التعديلات المباشرة (حساب Google الفعلي عبر onEdit)
CREATE TABLE IF NOT EXISTS edit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  editor        TEXT,                 -- بريد حساب Google الذي عدّل
  spreadsheet   TEXT,                 -- اسم الملف
  tab           TEXT,                 -- التبويب
  ref_no        TEXT,                 -- رقم الشحنة/المرجع للصف
  column_header TEXT,                 -- اسم العمود المعدّل
  old_value     TEXT,
  new_value     TEXT,
  row_num       INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_editlog_created ON edit_log(created_at);
