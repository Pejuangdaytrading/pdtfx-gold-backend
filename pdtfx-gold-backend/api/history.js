import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export default async function handler(req, res) {
  const list = await redis.lrange("signal_history", 0, 49);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(list || []);
}
