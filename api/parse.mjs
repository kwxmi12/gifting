async function sha256(str) {
const buf = await crypto.subtle.digest(“SHA-256”, new TextEncoder().encode(str));
return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, “0”)).join(””);
}

async function verifyToken(token) {
if (!token) return false;
try {
const [slug, ts, sig] = atob(token).split(”:”);
if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) return false;
const expectedSig = await sha256(`${slug}:${ts}:${process.env.ADMIN_SECRET}`);
return sig === expectedSig;
} catch { return false; }
}

export default async function handler(req, res) {
if (req.method !== “POST”) return res.status(405).json({ error: “Method not allowed” });

const { token, password, model, max_tokens, system, messages } = req.body || {};

// Support token auth or legacy APP_PASSWORD
const authed = (token && await verifyToken(token)) ||
(password && password === process.env.APP_PASSWORD);

if (!authed) return res.status(401).json({ error: “Unauthorized” });

try {
const response = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-api-key”: process.env.ANTHROPIC_API_KEY,
“anthropic-version”: “2023-06-01”,
},
body: JSON.stringify({ model, max_tokens, system, messages }),
});

```
const data = await response.json();
if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Anthropic error" });
return res.status(200).json(data);
```

} catch (err) {
return res.status(500).json({ error: err.message });
}
}