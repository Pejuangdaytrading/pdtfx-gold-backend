export default async function handler(req, res) {
  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: "KV env missing" });
    }

    const r = await fetch(`${url}/get/latest_signal`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const j = await r.json();
    const data = j?.result ?? null;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
