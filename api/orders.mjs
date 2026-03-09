async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyToken(token) {
  if (!token) return null;
  try {
    const [slug, ts, sig] = atob(token).split(":");
    if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) return null;
    const expectedSig = await sha256(`${slug}:${ts}:${process.env.ADMIN_SECRET}`);
    if (sig !== expectedSig) return null;
    return slug;
  } catch { return null; }
}

async function redisGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try {
    const parsed = JSON.parse(data.result);
    if (typeof parsed === 'string') return JSON.parse(parsed);
    return parsed;
  } catch { return null; }
}

async function redisSet(key, value) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

export default async function handler(req, res) {
  const token = req.method === "GET" ? req.query.token : req.body?.token;
  const legacyPassword = req.method === "GET" ? req.query.password : req.body?.password;

  let slug = null;

  if (token) {
    slug = await verifyToken(token);
    if (!slug) return res.status(401).json({ error: "Invalid or expired session" });
  } else if (legacyPassword && legacyPassword === process.env.APP_PASSWORD) {
    slug = "corvidae";
  } else {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const activeKey = `${slug}:orders:active`;
  const archivedKey = `${slug}:orders:archived`;

  try {
    if (req.method === "GET") {
      const orders = (await redisGet(activeKey)) || [];
      const archived = (await redisGet(archivedKey)) || [];
      return res.status(200).json({
        orders: Array.isArray(orders) ? orders : [],
        archived: Array.isArray(archived) ? archived : [],
        slug,
      });
    }
    if (req.method === "POST") {
      const { action, order, id } = req.body;
      if (action === "add") {
        const current = (await redisGet(activeKey)) || [];
        const safe = Array.isArray(current) ? current : [];
        safe.push(order);
        await redisSet(activeKey, safe);
        return res.status(200).json({ ok: true });
      }
      if (action === "update") {
        const active = (await redisGet(activeKey)) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet(activeKey, safe.map(o => o.id === order.id ? order : o));
        return res.status(200).json({ ok: true });
      }
      if (action === "delete") {
        const active = (await redisGet(activeKey)) || [];
        const safe = Array.isArray(active) ? active : [];
        await redisSet(activeKey, safe.filter(o => o.id !== id));
        return res.status(200).json({ ok: true });
      }
      if (action === "archive") {
        const active = (await redisGet(activeKey)) || [];
        const archived = (await redisGet(archivedKey)) || [];
        const safeActive = Array.isArray(active) ? active : [];
        const safeArchived = Array.isArray(archived) ? archived : [];
        const toArchive = safeActive.find(o => o.id === id);
        if (toArchive) {
          toArchive.status = "Sent";
          toArchive.archivedAt = new Date().toISOString();
          safeArchived.unshift(toArchive);
          await redisSet(activeKey, safeActive.filter(o => o.id !== id));
          await redisSet(archivedKey, safeArchived);
        }
        return res.status(200).json({ ok: true });
      }
      if (action === "unarchive") {
        const active = (await redisGet(activeKey)) || [];
        const archived = (await redisGet(archivedKey)) || [];
        const safeActive = Array.isArray(active) ? active : [];
        const safeArchived = Array.isArray(archived) ? archived : [];
        const toRestore = safeArchived.find(o => o.id === id);
        if (toRestore) {
          toRestore.status = "Pending";
          delete toRestore.archivedAt;
          safeActive.push(toRestore);
          await redisSet(activeKey, safeActive);
          await redisSet(archivedKey, safeArchived.filter(o => o.id !== id));
        }
        return res.status(200).json({ ok: true });
      }
      if (action === "deleteArchived") {
        const archived = (await redisGet(archivedKey)) || [];
        const safe = Array.isArray(archived) ? archived : [];
        await redisSet(archivedKey, safe.filter(o => o.id !== id));
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(400).json({ error: "Invalid request" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
