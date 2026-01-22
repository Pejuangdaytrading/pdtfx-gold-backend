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

function cleanLine(s) {
  return String(s || "").trim();
}

function toNumber(v) {
  if (!v) return NaN;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return parseFloat(cleaned);
}

function parseSignal(text = "") {
  const raw = String(text || "");
  const lines = raw
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
  const symbol =
    getAfterColon(findLineStartsWith("Pair")) ||
    getAfterColon(findLineStartsWith("Symbol"));

  const side = (getAfterColon(findLineStartsWith("Type")) || "").toUpperCase();
  const entry = toNumber(getAfterColon(findLineStartsWith("Entry")));

  // SL
  const slLine = lines.find((l) => l.toLowerCase().startsWith("sl"));
  const sl = toNumber(getAfterColon(slLine));

  // TP parsing:
  // Support: "TP1:", "TP 1:", "TP_1 :", "TP_1: 🔒 VIP Only", etc
  const tps = [];
  for (let i = 1; i <= 5; i++) {
    const re = new RegExp(`^TP[\\s_]*${i}\\s*[:=]`, "i");
    const tpLine = lines.find((l) => re.test(l));
    if (!tpLine) continue;

    // keep raw value, can be number or "🔒 VIP Only"
    const value = cleanLine(tpLine.split(/[:=]/).slice(1).join(":"));
    if (value) tps.push(value);
  }

  // Minimal validation for a signal
  if (!symbol || !side || Number.isNaN(entry) || Number.isNaN(sl)) return null;

  const ts = Math.floor(Date.now() / 1000);
  const id = `tg_${ts}_${String(entry).replace(".", "")}`;

  // store tps as string[] (numbers or VIP Only text)
  return { id, ts, symbol, side, entry, sl, tps, raw };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Secret check
  const expected = (process.env.WEBHOOK_SECRET || "").trim();
  const got = (req.query?.secret || "").trim();

  if (!expected || got !== expected) {
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
    const post = update?.channel_post || update?.message || null;

    if (!post) return res.status(200).json({ ok: true, ignored: true, why: "no_post" });

    // ✅ CHANNEL WHITELIST (PRIVATE CHANNEL)
    // Set env TG_ALLOWED_CHAT_ID = -1002192025020
    const allowedChatId = (process.env.TG_ALLOWED_CHAT_ID || "").trim();
    const incomingChatId = String(post?.chat?.id ?? "").trim();

    if (allowedChatId && incomingChatId !== allowedChatId) {
      // optional debug: record last blocked source (helps auditing)
      await kvSet("last_webhook_debug", {
        ts: Math.floor(Date.now() / 1000),
        incomingChatId,
        chatTitle: post?.chat?.title || "",
        chatType: post?.chat?.type || "",
        note: "blocked_by_chat_whitelist"
      });

      return res.status(200).json({ ok: true, blocked: true });
    }

    const text = post?.text || post?.caption || "";
    if (!text) return res.status(200).json({ ok: true, ignored: true, why: "no_text" });

    const signal = parseSignal(text);
    if (!signal) return res.status(200).json({ ok: true, parsed: false });

    // attach chat meta for auditing
    signal.chat = {
      id: incomingChatId,
      title: post?.chat?.title || "",
      type: post?.chat?.type || ""
    };

    await kvSet("latest_signal", signal);

    // Optional history
    try {
      await kvLPush("signal_history", signal);
      await kvLTrim("signal_history", 0, 49);
    } catch {
      // ignore if list ops not enabled
    }

    await kvSet("last_webhook_debug", {
      ts: signal.ts,
      incomingChatId,
      note: "saved_latest_signal"
    });

    return res.status(200).json({ ok: true, saved: true, id: signal.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
