export default function handler(req, res) {
  const s = process.env.WEBHOOK_SECRET || "";
  res.status(200).json({
    hasSecret: !!s,
    secretLen: s.length,
    envKeysHint: Object.keys(process.env).includes("WEBHOOK_SECRET")
  });
}
