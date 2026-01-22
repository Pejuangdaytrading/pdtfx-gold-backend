export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    hasSecret: !!process.env.WEBHOOK_SECRET,
    hasAllowedChat: !!process.env.TG_ALLOWED_CHAT_ID,
    allowedChat: process.env.TG_ALLOWED_CHAT_ID || null,
    version: "tg-webhook-whitelist-v2"
  });
}
