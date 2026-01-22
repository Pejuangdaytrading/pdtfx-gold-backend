// api/tg-webhook.js

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) throw new Error("Missing KV env");

  const r = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`KV set failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

function parseSignal(rawText = "") {
  const raw = String(rawText || "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const getVal = (prefix) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!line) return null;
    const parts = line.split(":");
    if (parts.length < 2) return null;
    return parts.slice(1).join(":").trim();
  };

  const symbol = getVal("Pair");
  const side = (getVal("Type") || "").toUpperCase();
  const entry = parseFloat(String(getVal("Entry") || "").replace(/[^\d.]/g, ""));
  const sl = parseFloat(String(getVal("SL") || "").replace(/[^\d.]/g, ""));

  // Parse TP1..TP5 supports: TP1, TP 1, TP_1 and value can be "VIP Only"
  const tps = [];
  for (let i = 1; i <= 5; i++) {
    const re = new RegExp(`^TP[\\s_]*${i}\\s*[:=]`, "i");
    const tpLine = lines.find((l) => re.test(l));
    if (!tpLine) continue;

    const v = tpLine.split(/[:=]/).slice(1).join(":").trim();
    if (v) tps.push(v);
  }

  if (!symbol || !side || Number.isNaN(entry) || Number.isNaN(sl)) return null;

  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `tg_${ts}_${String(entry).replace(".", "")}`,
    ts,
    symbol,
    side,
    entry,
    sl,
    tps,
    raw
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // secret check
  const expected = (process.env.WEBHOOK_SECRET || "").trim();
  const got = (req.query?.secret || "").trim();
  if (!expected || got !== expected) return res.status(403).send("Forbidden");

  const update = req.body || {};
  const post = update.channel_post || update.message;
  if (!post) return res.status(200).json({ ok: true, ignored: "no_post" });

  // ✅ whitelist by private channel id
  const allowedChatId = (process.env.TG_ALLOWED_CHAT_ID || "").trim(); // -1002192025020
  const incomingChatId = String(post.chat?.id ?? "").trim();

  if (allowedChatId && incomingChatId !== allowedChatId) {
    await kvSet("last_webhook_debug", {
      ts: Math.floor(Date.now() / 1000),
      incomingChatId,
      title: post.chat?.title || "",
      note: "blocked_by_whitelist"
    });
    return res.status(200).json({ ok: true, blocked: true });
  }

  const text = post.text || post.caption || "";
  const signal = parseSignal(text);
  if (!signal) return res.status(200).json({ ok: true, parsed: false });

  // attach chat meta (buat bukti bahwa kode baru sudah jalan)
  signal.chat = {
    id: incomingChatId,
    title: post.chat?.title || "",
    type: post.chat?.type || ""
  };

  await kvSet("latest_signal", signal);
  await kvSet("last_webhook_debug", { ts: signal.ts, note: "saved_latest_signal", chatId: incomingChatId });

  return res.status(200).json({ ok: true, saved: true, id: signal.id });
}
