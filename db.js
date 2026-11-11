import Database from "better-sqlite3";

const db = new Database(process.env.DB_FILE || "./trap.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  ip TEXT,
  location TEXT,
  device TEXT,
  os TEXT,
  browser TEXT,
  isp TEXT,
  ua TEXT,
  referrer TEXT,
  time TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_code ON visits(code);
`);

export default db;
