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
    if (typeof parsed === "string") return JSON.parse(parsed);
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
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  const metaKey = `${slug}:creator-meta`;

  // GET — return all meta
  if (req.method === "GET") {
    const meta = (await redisGet(metaKey)) || {};
    return res.status(200).json({ ok: true, meta });
  }

  // POST actions
  const { action, meta, id, key, value } = req.body || {};

  // Bulk set (replace entire meta object — used for migration)
  if (action === "setAll") {
    if (!meta || typeof meta !== "object") return res.status(400).json({ error: "meta object required" });
    await redisSet(metaKey, meta);
    return res.status(200).json({ ok: true });
  }

  // Set a single key on a single order
  if (action === "set") {
    if (!id || !key) return res.status(400).json({ error: "id and key required" });
    const current = (await redisGet(metaKey)) || {};
    if (!current[id]) current[id] = {};
    current[id][key] = value;
    await redisSet(metaKey, current);
    return res.status(200).json({ ok: true });
  }

  // Get all (POST version)
  if (action === "getAll") {
    const current = (await redisGet(metaKey)) || {};
    return res.status(200).json({ ok: true, meta: current });
  }

  return res.status(400).json({ error: "Invalid action" });
}
