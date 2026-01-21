async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const r = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });

  return r.json();
}

function parseSignal(text = "") {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const get = (k) =>
    lines.find(l => l.toLowerCase().startsWith(k.toLowerCase()))?.split(":").slice(1).join(":").trim();

  const symbol = get("Pair");
  const side = get("Type")?.toUpperCase();
  const entry = parseFloat(get("Entry"));
  const sl = parseFloat(get("SL"));

  const tps = [];
  for (let i = 1; i <= 5; i++) {
    const v = get(`TP${i}`);
    if (v) tps.push(parseFloat(v));
  }

  if (!symbol || !side || isNaN(entry) || isNaN(sl)) return null;

  return {
    id: `tg_${Date.now()}`,
    ts: Math.floor(Date.now() / 1000),
    symbol,
    side,
    entry,
    sl,
    tps,
    raw: text
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.query.secret !== process.env.WEBHOOK_SECRET) return res.status(403).end();

  const text = req.body?.channel_post?.text;
  if (!text) return res.json({ ok: true });

  const signal = parseSignal(text);
  if (!signal) return res.json({ ok: false });

  await kvSet("latest_signal", signal);
  return res.json({ ok: true, saved: true });
}
