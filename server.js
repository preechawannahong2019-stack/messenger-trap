import express from "express";
import dotenv from "dotenv";
import db from "./db.js";
import { notifyAdmin } from "./notify.js";
import webhook from "./webhook.js";

dotenv.config();
const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(express.static("public"));
app.use(webhook);

app.get("/trap/:code", async (req, res) => {
  const link = db.prepare("SELECT * FROM links WHERE code = ?").get(req.params.code);
  const ip = ((req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip).replace("::ffff:", "");
  const ua = req.headers["user-agent"] || "";

  const visit = {
    code: req.params.code,
    ip,
    location: "Unknown",
    device: /Mobile|Android|iPhone/i.test(ua) ? "mobile" : "desktop",
    os: /Windows/.test(ua) ? "Windows"
      : /Android/.test(ua) ? "Android"
      : /iPhone|iOS/.test(ua) ? "iOS"
      : /Mac OS/.test(ua) ? "macOS" : "Linux",
    browser: /Edg\//.test(ua) ? "Edge"
      : /Chrome\//.test(ua) ? "Chrome"
      : /Safari\//.test(ua) ? "Safari"
      : /Firefox\//.test(ua) ? "Firefox" : "Unknown",
    isp: null,
    referrer: req.headers.referer || null,
    time: new Date().toISOString()
  };

  const info = db.prepare(`INSERT INTO visits (code,ip,location,device,os,browser,isp,ua,referrer,time)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(visit.code, visit.ip, visit.location, visit.device, visit.os,
         visit.browser, visit.isp, ua, visit.referrer, visit.time);
  visit.id = info.lastInsertRowid;

  fetch("http://ip-api.com/json/" + ip + "?fields=status,country,regionName,city,isp")
    .then((r) => r.json())
    .then((g) => {
      if (g.status === "success") {
        visit.location = g.city + ", " + g.regionName + ", " + g.country;
        visit.isp = g.isp;
        db.prepare("UPDATE visits SET location=?, isp=? WHERE id=?")
          .run(visit.location, visit.isp, visit.id);
      }
    })
    .catch(() => {});

  notifyAdmin(visit);
  console.log("Trap hit! code=" + visit.code + " ip=" + ip);

  if (link) return res.redirect(302, link.destination);
  res.sendFile("public/decoy.html", { root: "." });
});

app.post("/api/trap/create", (req, res) => {
  const { code, destination } = req.body;
  if (!code || !destination)
    return res.status(400).json({ error: "code and destination required" });
  db.prepare("INSERT OR REPLACE INTO links VALUES (?,?,datetime('now'))")
    .run(code, destination);
  res.json({ ok: true, trapUrl: "/trap/" + code });
});

app.get("/api/stats/:code", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) n FROM visits WHERE code=?")
    .get(req.params.code).n;
  const visits = db.prepare("SELECT * FROM visits WHERE code=? ORDER BY id DESC LIMIT 100")
    .all(req.params.code);
  res.json({ code: req.params.code, total, visits });
});

app.get("/api/stats", (req, res) => {
  res.json({
    summary: db.prepare(`SELECT code, COUNT(*) as clicks, MAX(time) as last_hit
                         FROM visits GROUP BY code ORDER BY last_hit DESC`).all()
  });
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on http://localhost:" + (process.env.PORT || 3000)));
