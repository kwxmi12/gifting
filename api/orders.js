async function redisGet(key) {
  const res = await fetch(
    `${process.env.UPSTASH_URL}/get/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` } }
  );
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function redisSet(key, value) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  await fetch(
    `${process.env.UPSTASH_URL}/set/${encodeURIComponent(key)}/${encoded}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` },
    }
  );
}

async function handler(req, res) {
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
        const safe = Array.isArray(active) ? safe : [];
        await redisSet("orders:active", safe.map(o => o.id === order.id ? order : o));
        return res.status(200).json({ ok: true });
      }
      if (action === "delete") {
        const active = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet("orders:active", safe.filter(o => o.id !== id));
        return res.status(200).json({ ok: true });
      }
      if (action === "archive") {
        const active = (await redisGet("orders:active")) || [];
        const archived = (await redisGet("orders:archived")) || [];
        const customers = (await redisGet("customers")) || {};
        const safeActive = Array.isArray(active) ? active : [];
        const safeArchived = Array.isArray(archived) ? archived : [];
        const toArchive = safeActive.find(o => o.id === id);
        if (toArchive) {
          toArchive.status = "Sent";
          toArchive.archivedAt = new Date().toISOString();
          safeArchived.unshift(toArchive);
          const remaining = safeActive.filter(o => o.id !== id);
          const name = toArchive.full_name || `${toArchive.first_name || ""} ${toArchive.last_name || ""}`.trim();
          if (name) {
            if (!customers[name]) customers[name] = { orders: [] };
            customers[name].orders.push({ id: toArchive.id, archivedAt: toArchive.archivedAt, items: toArchive.items });
          }
          await redisSet("orders:active", remaining);
          await redisSet("orders:archived", safeArchived);
          await redisSet("customers", customers);
        }
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(400).json({ error: "Bad request" });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = handler;
