import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import db from "./db.js";
import { notifyAdmin } from "./notify.js";
import webhook from "./webhook.js";

dotenv.config();
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use(webhook);

const TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IMAGE_URL = process.env.AUTO_IMAGE_URL || "";
const AUTO_TEXT = process.env.AUTO_TEXT || "ขอบคุณที่ติดต่อครับ";
const PAGE_NAME = (process.env.PAGE_NAME || "have a nice day").trim();

/* ---------- ตัวบันทึกผู้เยี่ยมชมกลาง (ใช้ทุก endpoint) ---------- */
function logVisit(code, req) {
  const ip = ((req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip).replace("::ffff:", "");
  const ua = req.headers["user-agent"] || "";
  const visit = {
    code, ip, location: "Unknown",
    device: /Mobile|Android|iPhone/i.test(ua) ? "mobile" : "desktop",
    os: /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android"
      : /iPhone|iOS/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : "Linux",
    browser: /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome"
      : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox"
      : /GoogleImageProxy/.test(ua) ? "GmailProxy" : "Unknown",
    isp: null, referrer: req.headers.referer || null,
    time: new Date().toISOString()
  };
  const info = db.prepare(`INSERT INTO visits (code,ip,location,device,os,browser,isp,ua,referrer,time)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(code, visit.ip, visit.location, visit.device, visit.os,
         visit.browser, visit.isp, ua, visit.referrer, visit.time);
  visit.id = info.lastInsertRowid;
  fetch("http://ip-api.com/json/" + ip + "?fields=status,country,regionName,city,isp")
    .then((r) => r.json()).then((g) => {
      if (g.status === "success") {
        visit.location = g.city + ", " + g.regionName + ", " + g.country;
        visit.isp = g.isp;
        db.prepare("UPDATE visits SET location=?, isp=? WHERE id=?")
          .run(visit.location, visit.isp, visit.id);
      }
    }).catch(() => {});
  notifyAdmin(visit);
  console.log("Hit! code=" + code + " ip=" + ip + " ua=" + ua.slice(0, 60));
  return visit;
}

/* ---------- Email Tracking Pixel: /track.gif?e=ชื่อเคส ---------- */
app.get("/track.gif", (req, res) => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate", "Content-Length": gif.length });
  res.send(gif);
  logVisit("email-" + String(req.query.e || "x").slice(0, 40), req);
});

/* ---------- Email Tracking แบบภาพหลอกเต็ม: /img/ชื่อเคส.jpg ---------- */
app.get("/img/:code.jpg", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile("public/images/decoy.jpg", { root: "." });
  logVisit("email-" + String(req.params.code).slice(0, 40), req);
});

/* ---------- Auto-reply engine ---------- */
const lastReply = new Map();
async function autoReply(psid) {
  const last = lastReply.get(psid) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  lastReply.set(psid, Date.now());
  console.log("Auto-reply to PSID:", psid);
  if (IMAGE_URL) await sendImageTo(psid, IMAGE_URL);
  await sendTextTo(psid, AUTO_TEXT);
}
async function sendTextTo(recipientId, text) {
  try {
    await axios.post("https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: TOKEN } });
    console.log("Text sent to", recipientId);
  } catch (err) { console.error("Text failed:", err.response?.data?.error?.message); }
}
async function sendImageTo(recipientId, url) {
  try {
    await axios.post("https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: recipientId },
        message: { attachment: { type: "image", payload: { url, is_reusable: true } } } },
      { params: { access_token: TOKEN } });
    console.log("Image sent to", recipientId);
  } catch (err) { console.error("Image failed:", err.response?.data?.error?.message); }
}

/* ---------- Inbox Poller ทุก 60 วิ ---------- */
const convoState = new Map();
let firstPoll = true;
async function pollInbox() {
  if (!TOKEN) return;
  try {
    const r = await axios.get("https://graph.facebook.com/v21.0/me/conversations", {
      params: { fields: "participants,updated_time", limit: "10", access_token: TOKEN }
    });
    for (const c of r.data.data || []) {
      const prev = convoState.get(c.id);
      convoState.set(c.id, c.updated_time);
      if (firstPoll || prev === c.updated_time) continue;
      const parts = (c.participants && c.participants.data) || [];
      const user = parts.find(p => !(p.name || "").includes(PAGE_NAME)) || parts[0];
      if (!user) continue;
      console.log("New message in", c.id, "-> PSID:", user.id);
      await autoReply(user.id);
    }
    firstPoll = false;
  } catch (e) { console.error("Poll error:", e.response?.data?.error?.message || e.message); }
}
setTimeout(pollInbox, 5000);
setInterval(pollInbox, 60000);

/* ---------- WebRTC logger ---------- */
app.post("/api/webrtc-log", (req, res) => {
  res.sendStatus(200);
  try {
    const ip = ((req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip).replace("::ffff:", "");
    const ua = req.headers["user-agent"] || "";
    const tag = String(req.boROM links WHERE code = ?").get(req.params.code);
  logVisit(req.params.code, req);
  if (link) return res.redirect(302, link.destination);
  res.sendFile("public/decoy.html", { root: "." });
});

app.post("/api/trap/create", (req, res) => {
  const { code, destination } = req.body;
  if (!code || !destination)
    return res.status(400).json({ error: "code and destination required" });
  db.prepare("INSERT OR REPLACE INTO links VALUES (?,?,datetime('now'))").run(code, destination);
  res.json({ ok: true, trapUrl: "/trap/" + code });
});

app.get("/api/stats/:code", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) n FROM visits WHERE code=?").get(req.params.code).n;
  const visits = db.prepare("SELECT * FROM visits WHERE code=? ORDER BY id DESC LIMIT 100").all(req.params.code);
  res.json({ code: req.params.code, total, visits });
});

app.get("/api/stats", (req, res) => {
  res.json({ summary: db.prepare(`SELECT code, COUNT(*) as clicks, MAX(time) as last_hit
                         FROM visits GROUP BY code ORDER BY last_hit DESC`).all() });
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on http://localhost:" + (process.env.PORT || 3000)));
