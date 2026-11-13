import pg from "pg";
import dns from "dns";
import db from "./db.js";

const URL = process.env.DATABASE_URL || "";
let client = null;
let syncing = false;

export async function initMirror() {
  if (!URL) { console.log("DATABASE_URL not set, mirror disabled"); return; }
  try {
    const u = new URL(URL);
    const lookup = await dns.promises.lookup(u.hostname, { family: 4 });
    client = new pg.Client({ connectionString: URL, host: lookup.address, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query("CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, destination TEXT NOT NULL, created_at TEXT)");
    await client.query("CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, code TEXT, ip TEXT, location TEXT, device TEXT, os TEXT, browser TEXT, isp TEXT, ua TEXT, referrer TEXT, time TEXT)");
    const lv = await client.query("SELECT * FROM visits ORDER BY id");
    for (const r of lv.rows) {
      db.prepare("INSERT INTO visits (id,code,ip,location,device,os,browser,isp,ua,referrer,time) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
        .run(r.id, r.code, r.ip, r.location, r.device, r.os, r.browser, r.isp, r.ua, r.referrer, r.time);
    }
    const ll = await client.query("SELECT * FROM links");
    for (const r of ll.rows) {
      db.prepare("INSERT INTO links (code,destination,created_at) VALUES (?,?,?) ON CONFLICT(code) DO NOTHING")
        .run(r.code, r.destination, r.created_at);
    }
    console.log("Mirror restore:", lv.rows.length, "visits,", ll.rows.length, "links");
    setInterval(fullSync, 60000);
    fullSync();
  } catch (e) {
    console.error("Mirror init failed:", e.message);
  }
}

export async function mirrorWipe() {
  if (!client) return;
  try {
    await client.query("DELETE FROM visits");
    await client.query("DELETE FROM links");
    console.log("Mirror wiped");
  } catch (e) {
    console.error("Mirror wipe failed:", e.message);
  }
}

async function fullSync() {
  if (!client || syncing) return;
  syncing = true;
  try {
    const visits = db.prepare("SELECT * FROM visits ORDER BY id").all();
    for (const v of visits) {
      await client.query("INSERT INTO visits (id,code,ip,location,device,os,browser,isp,ua,referrer,time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET location=EXCLUDED.location, isp=EXCLUDED.isp",
        [v.id, v.code, v.ip, v.location, v.device, v.os, v.browser, v.isp, v.ua, v.referrer, v.time]);
    }
    const links = db.prepare("SELECT * FROM links").all();
    for (const l of links) {
      await client.query("INSERT INTO links (code,destination,created_at) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET destination=EXCLUDED.destination",
        [l.code, l.destination, l.created_at]);
    }
    console.log("Mirror synced:", visits.length, "visits,", links.length, "links");
  } catch (e) {
    console.error("Mirror sync failed:", e.message);
  } finally { syncing = false; }
}
