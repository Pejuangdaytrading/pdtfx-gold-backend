// api/tg-webhook.js

async function kvFetch(path, token, bodyObj = null) {
  const opts = {
    method: bodyObj ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);

  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");

  // Vercel KV REST: POST /set/<key> with JSON body
  const { ok, status, json } = await kvFetch(
    `${url}/set/${encodeURIComponent(key)}`,
    token,
    value
  );
  if (!ok) throw new Error(`KV set failed (${status}): ${JSON.stringify(json)}`);
  return json;
}

async function kvLPush(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");

  // Some KV REST endpoints support list ops; if not available on your KV,
  // comment out history usage below (latest_signal will still work).
  const { ok, status, json } = await kvFetch(
    `${url}/lpush/${encodeURIComponent(key)}`,
    token,
    [value]
  );
  if (!ok) throw new Error(`KV lpush failed (${status}): ${JSON.stringify(json)}`);
  return json;
}

async function kvLTrim(key, start, stop) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");

  const { ok, status, json } = await kvFetch(
    `${url}/ltrim/${encodeURIComponent(key)}/${start}/${stop}`,
    token
  );
  if (!ok) throw new Error(`KV ltrim failed (${status}): ${JSON.stringify(json)}`);
  return json;
}

function toNumber(v) {
  if (!v) return NaN;
  // keep digits + dot only
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return parseFloat(cleaned);
}

function parseSignal(text = "") {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const findLineStartsWith = (prefix) =>
    lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));

  const getAfterColon = (line) => {
    if (!line) return null;
    const parts = line.split(":");
    if (parts.length < 2) return null;
    return parts.slice(1).join(":").trim();
  };

  // Pair / Type / Entry
  const symbol = getAfterColon(findLineStartsWith("Pair")) || getAfterColon(findLineStartsWith("Symbol"));
  const side = (getAfterColon(findLineStartsWith("Type")) || "").toUpperCase();
  const entry = toNumber(getAfterColon(findLineStartsWith("Entry")));

  // SL: handle "SL   : 4644.628 ⛔️" (starts with "SL" not necessarily "SL:")
  const slLine = lines.find((l) => l.toLowerCase().startsWith("sl"));
  const sl = toNumber(getAfterColon(slLine));

  // TP1..TP5
  const tps = [];
  for (let i = 1; i <= 5; i++) {
    const tpLine = findLineStartsWith(`TP${i}`);
    const n = toNumber(getAfterColon(tpLine));
    if (!Number.isNaN(n)) tps.push(n);
  }

  // Minimal validation
  if (!symbol || !side || Number.isNaN(entry) || Number.isNaN(sl)) return null;

  const ts = Math.floor(Date.now() / 1000);
  const id = `tg_${ts}_${String(entry).replace(".", "")}`;

  return { id, ts, symbol, side, entry, sl, tps, raw: text };
}

export default async function handler(req, res) {
  // Only accept POST from Telegram
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Robust secret check (trim to avoid hidden whitespace mismatch)
  const expected = (process.env.WEBHOOK_SECRET || "").trim();
  const got = (req.query?.secret || "").trim();

  if (!expected || got !== expected) {
    // Return safe debug info so we can see why Telegram gets 403 (no secret leak)
    return res.status(403).json({
      ok: false,
      reason: "forbidden",
      expectedLen: expected.length,
      gotLen: got.length,
      gotPreview: got ? got.slice(0, 6) + "..." : "",
      hint: "Check setWebhook URL includes ?secret=YOUR_SECRET and env is deployed"
    });
  }

  try {
    const update = req.body || {};
    const text =
      update?.channel_post?.text ||
      update?.channel_post?.caption || // in case signal sent as photo + caption
      update?.message?.text ||
      update?.message?.caption ||
      "";

    if (!text) return res.status(200).json({ ok: true, ignored: true });

    const signal = parseSignal(text);
    if (!signal) return res.status(200).json({ ok: true, parsed: false });

    // Save latest
    await kvSet("latest_signal", signal);

    // Optional: keep history (if your KV supports list ops)
    try {
      await kvLPush("signal_history", signal);
      await kvLTrim("signal_history", 0, 49); // keep 50 last
    } catch {
      // ignore if list endpoints not enabled
    }

    return res.status(200).json({ ok: true, saved: true, id: signal.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
