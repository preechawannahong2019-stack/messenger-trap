import express from "express";
import axios from "axios";

const router = express.Router();
const TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123";

/* ตั้งค่าใน Railway Variables:
   AUTO_IMAGE_URL = URL ภาพที่จะส่งอัตโนมัติ (เว้นว่าง = ไม่ส่งภาพ)
   AUTO_TEXT      = ข้อความล่อที่จะส่งตามหลังภาพ                        */
const IMAGE_URL = process.env.AUTO_IMAGE_URL || "";
const AUTO_TEXT = process.env.AUTO_TEXT ||
  "ขอบคุณที่ติดต่อครับ รายละเอียดเพิ่มเติมดูได้ที่นี่ครับ 👉 https://example.com";

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified OK");
    return res.status(200).send(challenge);
  }
  console.log("Webhook verify FAILED, got token:", token);
  res.sendStatus(403);
});

router.post("/webhook", express.json(), async (req, res) => {
  res.sendStatus(200);
  const events = req.body.entry?.[0]?.messaging || [];
  for (const event of events) {
    if (!event.message || event.message.is_echo) continue;
    const senderId = event.sender.id;
    console.log("========================================");
    console.log("PSID:", senderId, "| Message:", event.message.text || "(attachment)");
    console.log("========================================");

    if (IMAGE_URL) {
      await sendImage(senderId, IMAGE_URL);
    }
    await sendText(senderId, AUTO_TEXT);
  }
});

async function sendText(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: TOKEN } }
    );
    console.log("Text sent to", recipientId);
  } catch (err) {
    console.error("Text failed:", err.response?.data?.error?.message);
  }
}

async function sendImage(recipientId, url) {
  try {
    await axios.post(
      "https://graph.facebook.com/v21.0/me/messages",
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: { url, is_reusable: true }
          }
        }
      },
      { params: { access_token: TOKEN } }
    );
    console.log("Image sent to", recipientId);
  } catch (err) {
    console.error("Image failed:", err.response?.data?.error?.message);
  }
}

export default router;
