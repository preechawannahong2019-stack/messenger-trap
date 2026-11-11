import express from "express";
import axios from "axios";

const router = express.Router();
const TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mysecret123";

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
    console.log("PSID:", senderId, "| Message:", event.message.text || "(attachment)");
    await sendText(senderId, "ระบบเชื่อมต่อแล้วครับ (PSID ของคุณ: " + senderId + ")");
  }
});

async function sendText(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: TOKEN } }
    );
    console.log("Replied to", recipientId);
  } catch (err) {
    console.error("Reply failed:", err.response?.data?.error?.message);
  }
}

export default router;
