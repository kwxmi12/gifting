// api/accounts.mjs
// Manages account creation and authentication
// Uses SHA-256 hashing (no native crypto needed in Vercel Edge/Node)

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, slug, password, adminSecret } = req.body || {};

  // ── Create account (admin only) ──────────────────────
  if (action === "create") {
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "Invalid admin secret" });
    }
    if (!slug || !password) return res.status(400).json({ error: "slug and password required" });

    const existing = await redisGet(`account:${slug}`);
    if (existing) return res.status(409).json({ error: "Account already exists" });

    const hashed = await sha256(password);
    await redisSet(`account:${slug}`, {
      slug,
      passwordHash: hashed,
      createdAt: new Date().toISOString(),
      plan: "team",
    });

    return res.status(200).json({ ok: true, slug, message: `Account '${slug}' created` });
  }

  // ── Login ────────────────────────────────────────────
  if (action === "login") {
    if (!slug || !password) return res.status(400).json({ error: "slug and password required" });

    const account = await redisGet(`account:${slug}`);
    if (!account) return res.status(401).json({ error: "Invalid account or password" });

    const hashed = await sha256(password);
    if (hashed !== account.passwordHash) {
      return res.status(401).json({ error: "Invalid account or password" });
    }

    // Return a signed session token: base64(slug:timestamp:hash)
    const ts = Date.now();
    const sig = await sha256(`${slug}:${ts}:${process.env.ADMIN_SECRET}`);
    const token = btoa(`${slug}:${ts}:${sig}`);

    return res.status(200).json({ ok: true, token, slug });
  }

  // ── Verify token ─────────────────────────────────────
  if (action === "verify") {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token required" });
    try {
      const [tSlug, ts, sig] = atob(token).split(":");
      // Token expires after 30 days
      if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) {
        return res.status(401).json({ error: "Token expired" });
      }
      const expectedSig = await sha256(`${tSlug}:${ts}:${process.env.ADMIN_SECRET}`);
      if (sig !== expectedSig) return res.status(401).json({ error: "Invalid token" });
      return res.status(200).json({ ok: true, slug: tSlug });
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // ── Change password (admin only) ─────────────────────
  if (action === "changePassword") {
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "Invalid admin secret" });
    }
    if (!slug || !password) return res.status(400).json({ error: "slug and password required" });
    const account = await redisGet(`account:${slug}`);
    if (!account) return res.status(404).json({ error: "Account not found" });
    account.passwordHash = await sha256(password);
    await redisSet(`account:${slug}`, account);
    return res.status(200).json({ ok: true, message: `Password updated for '${slug}'` });
  }

  return res.status(400).json({ error: "Invalid action" });
}
