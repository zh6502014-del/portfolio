-- 前台區塊顯示開關
CREATE TABLE IF NOT EXISTS section_settings (
  key TEXT PRIMARY KEY,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE section_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON section_settings;
DROP POLICY IF EXISTS "auth write" ON section_settings;
CREATE POLICY "public read" ON section_settings FOR SELECT USING (true);
CREATE POLICY "auth write" ON section_settings FOR ALL USING (auth.role() = 'authenticated');
