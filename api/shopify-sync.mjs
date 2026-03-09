const SHOP = "crvdae.myshopify.com";
const API = "2026-01";

async function shopifyFetch(path) {
  const res = await fetch(`https://${SHOP}/admin/api/${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
    },
  });
  return { status: res.status, data: await res.json() };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { password, token, email, name } = req.body || {};
  // Support token auth or legacy password
  let authed = false;
  if (token) {
    try {
      const [slug, ts, sig] = atob(token).split(":");
      if (Date.now() - parseInt(ts) <= 30 * 24 * 60 * 60 * 1000) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${slug}:${ts}:${process.env.ADMIN_SECRET}`));
        const expectedSig = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
        if (sig === expectedSig) authed = true;
      }
    } catch {}
  } else if (password === process.env.APP_PASSWORD) {
    authed = true;
  }
  if (!authed) return res.status(401).json({ error: "Unauthorized" });
  if (!email && !name) return res.status(400).json({ error: "email or name required" });

  try {
    let orders = [];

    // Try by email first (most reliable)
    if (email) {
      const { data } = await shopifyFetch(
        `/orders.json?email=${encodeURIComponent(email)}&status=any&limit=5&fields=id,name,fulfillments,created_at`
      );
      orders = data.orders || [];
    }

    // Fallback: search customers by name, then fetch their orders
    if (orders.length === 0 && name) {
      const { data: cData } = await shopifyFetch(
        `/customers/search.json?query=${encodeURIComponent(name)}&limit=3&fields=id,email,first_name,last_name`
      );
      const customers = cData.customers || [];
      for (const c of customers) {
        const { data: oData } = await shopifyFetch(
          `/orders.json?customer_id=${c.id}&status=any&limit=3&fields=id,name,fulfillments,created_at`
        );
        orders.push(...(oData.orders || []));
      }
    }

    if (orders.length === 0) {
      return res.status(200).json({ found: false, message: "No orders found for this customer" });
    }

    // Sort by most recent
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = orders[0];

    // Pull tracking from fulfillments
    let trackingNumber = null;
    let trackingUrl = null;
    if (latest.fulfillments && latest.fulfillments.length > 0) {
      const fulfillment = latest.fulfillments[latest.fulfillments.length - 1];
      trackingNumber = fulfillment.tracking_number || null;
      trackingUrl = fulfillment.tracking_url || null;
    }

    return res.status(200).json({
      found: true,
      orderName: latest.name,       // e.g. "#32097"
      orderId: latest.id,
      trackingNumber,
      trackingUrl,
      totalOrders: orders.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
