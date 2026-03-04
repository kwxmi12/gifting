const handler = async (req, res) => {
  const redisGet = async (key) => {
    const r = await fetch(
      `${process.env.UPSTASH_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` } }
    );
    const d = await r.json();
    if (!d.result) return null;
    try { return JSON.parse(d.result); } catch { return null; }
  };

  const redisSet = async (key, value) => {
    await fetch(
      `${process.env.UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: "GET", headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` } }
    );
  };

  const password = req.method === "GET" ? req.query.password : req.body?.password;
  if (password !== process.env.APP_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    if (req.method === "GET") {
      const orders = (await redisGet("orders:active")) || [];
      const archived = (await redisGet("orders:archived")) || [];
      const customers = (await redisGet("customers")) || {};
      res.status(200).json({
        orders: Array.isArray(orders) ? orders : [],
        archived: Array.isArray(archived) ? archived : [],
        customers,
      });
      return;
    }
    if (req.method === "POST") {
      const { action, order, id } = req.body;
      if (action === "add") {
        const current = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(current) ? current : [];
        safe.push(order);
        await redisSet("orders:active", safe);
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "update") {
        const active = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet("orders:active", safe.map(o => o.id === order.id ? order : o));
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "delete") {
        const active = (await redisGet("orders:active")) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet("orders:active", safe.filter(o => o.id !== id));
        res.status(200).json({ ok: true });
        return;
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
        res.status(200).json({ ok: true });
        return;
      }
    }
    res.status(400).json({ error: "Bad request" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = handler;
