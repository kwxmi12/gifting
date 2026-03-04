async function redisGet(key) {
  const url = `${process.env.UPSTASH_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function redisSet(key, value) {
  const url = `${process.env.UPSTASH_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_TOKENN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

export default async function handler(req, res) {
  const password = req.method === "GET" ? req.query.password : req.body?.password;
  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    if (req.method === "GET") {
      const orders = (await redisGet("orders:active")) || [];
      const archived = (await redisGet("orders:archived")) || [];
      const customers = (await redisGet("customers")) || {};
      return res.status(200).json({
        orders: Array.isArray(orders) ? orders : [],
        archived: Array.isArray(archived) ? archived : [],
        customers,
      });
    }
    if (req.method === "POST") {
      const { action, order, id } = req.body;
      if (action === "add") {
        const current = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(current) ? current : [];
        safe.push(order);
        await redisSet("orders:active", safe);
        return res.status(200).json({ ok: true });
      }
      if (action === "update") {
        const active = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet("orders:active", safe.map(o => o.id === order.id ? order : o));
        return res.status(200).json({ ok: true });
      }
      if (action === "delete") {
        const active = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet("orders:active", safe.filter(o => o.id !== id));
        return res.status(200).json({ ok: true });
      }
      if (action === "archi
