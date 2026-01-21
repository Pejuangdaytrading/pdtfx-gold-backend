import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export default async function handler(req, res) {
  const data = await redis.get("latest_signal");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(data || null);
}
