// Upstash Redis - uses env vars auto-added by Vercel/Upstash integration
// Variable names: KV_REST_API_URL and KV_REST_API_TOKEN

// Upstash Redis - uses env vars auto-added by Vercel/Upstash integration
// Variable names: KV_REST_API_URL and KV_REST_API_TOKEN

async function redisGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
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
      return res.status(200).json({ orders, archived });
    }

    if (req.method === "POST") {
      const { action, order, id } = req.body;

      if (action === "add") {
        const current = (await redisGet("orders:active")) || [];
        current.push(order);
        await redisSet("orders:active", current);
        return res.status(200).json({ ok: true });
      }

      if (action === "update") {
        const active = (await redisGet("orders:active")) || [];
        await redisSet("orders:active", active.map(o => o.id === order.id ? order : o));
        return res.status(200).json({ ok: true });
      }

      if (action === "delete") {
        const active = (await redisGet("orders:active")) || [];
        await redisSet("orders:active", active.filter(o => o.id !== id));
        return res.status(200).json({ ok: true });
      }

      if (action === "archive") {
        const active = (await redisGet("orders:active")) || [];
        const archived = (await redisGet("orders:archived")) || [];
        const toArchive = active.find(o => o.id === id);
        if (toArchive) {
          toArchive.status = "Sent";
          toArchive.archivedAt = new Date().toISOString();
          archived.unshift(toArchive);
          await redisSet("orders:active", active.filter(o => o.id !== id));
          await redisSet("orders:archived", archived);
        }
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(400).json({ error: "Invalid request" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
