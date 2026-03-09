// api/setup.mjs
// ONE-TIME USE: Creates the Corvidae account and migrates existing Redis data
// Call once via POST /api/setup with { adminSecret, action: "migrate" }
// Then DELETE or disable this file

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function redisGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  const data = await res.json();
  if (!data.result) return null;
  try { const p = JSON.parse(data.result); return typeof p === "string" ? JSON.parse(p) : p; } catch { return null; }
}

async function redisSet(key, value) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { adminSecret, action, password } = req.body || {};

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Invalid admin secret" });
  }

  if (action === "migrate") {
    const results = {};

    // 1. Create Corvidae account
    const existing = await redisGet("account:corvidae");
    if (existing) {
      results.account = "already exists";
    } else {
      if (!password) return res.status(400).json({ error: "password required to create account" });
      const hashed = await sha256(password);
      await redisSet("account:corvidae", {
        slug: "corvidae",
        passwordHash: hashed,
        createdAt: new Date().toISOString(),
        plan: "team",
      });
      results.account = "created";
    }

    // 2. Migrate orders from old keys to namespaced keys
    const oldActive = await redisGet("orders:active");
    const oldArchived = await redisGet("orders:archived");

    if (oldActive !== null) {
      const existingNew = await redisGet("corvidae:orders:active");
      if (!existingNew) {
        await redisSet("corvidae:orders:active", oldActive);
        results.activeOrders = `migrated ${Array.isArray(oldActive) ? oldActive.length : 0} orders`;
      } else {
        results.activeOrders = "already migrated";
      }
    } else {
      results.activeOrders = "no old data found";
    }

    if (oldArchived !== null) {
      const existingNew = await redisGet("corvidae:orders:archived");
      if (!existingNew) {
        await redisSet("corvidae:orders:archived", oldArchived);
        results.archivedOrders = `migrated ${Array.isArray(oldArchived) ? oldArchived.length : 0} orders`;
      } else {
        results.archivedOrders = "already migrated";
      }
    } else {
      results.archivedOrders = "no old data found";
    }

    return res.status(200).json({ ok: true, results });
  }

  return res.status(400).json({ error: "Unknown action. Use action: 'migrate'" });
}
