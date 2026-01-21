import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function parseSignal(text = "") {
  // Expected format:
  // 🚀 PDTFX VIP Signal
  // Pair: XAUUSDm
  // Type: BUY
  // Entry: 4662.576
  // SL   : 4644.628 ⛔️
  // TP1: ...
  // TP5: ...

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const getField = (name) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ":"));
    if (!line) return null;
    return line.split(":").slice(1).join(":").trim();
    // handle "SL   :" juga tetap masuk karena startsWith("sl:")
  };

  // handle "SL   :"
  const getSL = () => {
    const line = lines.find((l) => l.toLowerCase().startsWith("sl"));
    if (!line) return null;
    const parts = line.split(":");
    if (parts.length < 2) return null;
    return parts.slice(1).join(":").trim();
  };

  const symbol = getField("Pair") || getField("Symbol");
  const side = (getField("Type") || "").toUpperCase();
  const entryRaw = getField("Entry");
  const slRaw = getSL();

  const entry = parseFloat((entryRaw || "").replace(/[^\d.]/g, ""));
  const sl = parseFloat((slRaw || "").replace(/[^\d.]/g, ""));

  const tps = [];
  for (let i = 1; i <= 10; i++) {
    const v = getField(`TP${i}`);
    if (!v) continue;
    const n = parseFloat(v.replace(/[^\d.]/g, ""));
    if (!Number.isNaN(n)) tps.push(n);
  }

  if (!symbol || !side || Number.isNaN(entry) || Number.isNaN(sl)) return null;

  const ts = Math.floor(Date.now() / 1000);
  const id = `tg_${ts}_${String(entry).replace(".", "")}`;

  return { id, ts, symbol, side, entry, sl, tps, raw: text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // simple protection
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).send("Forbidden");
  }

  try {
    const update = req.body;

    // Channel message arrives here
    const text =
      update?.channel_post?.text ||
      update?.channel_post?.caption || // kalau suatu saat pakai gambar + caption
      update?.message?.text ||
      update?.message?.caption;

    if (!text) return res.status(200).json({ ok: true, ignored: true });

    const parsed = parseSignal(text);
    if (!parsed) return res.status(200).json({ ok: true, parsed: false });

    await redis.set("latest_signal", parsed);
    await redis.lpush("signal_history", parsed);
    await redis.ltrim("signal_history", 0, 199);

    return res.status(200).json({ ok: true, saved: true, id: parsed.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
