export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password, order } = req.body;
  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const lineItems = (order.items || []).map(item => ({
      title: item,
      quantity: 1,
      price: "0.00",
      requires_shipping: true,
    }));

    if (lineItems.length === 0) {
      lineItems.push({
        title: "Gift",
        quantity: 1,
        price: "0.00",
        requires_shipping: true,
      });
    }

    const draftOrder = {
      draft_order: {
        line_items: lineItems,
        shipping_address: {
          first_name: order.first_name || "",
          last_name: order.last_name || "",
          address1: order.address_line1 || "",
          city: order.city || "",
          zip: order.postcode || "",
          country_code: order.country_code || "",
          phone: order.phone || "",
        },
        customer: {
          email: order.email || "",
        },
        note: `Gifting Studio order · ${order.notes || ""}`.trim(),
        tags: "gifting-studio",
      },
    };

    const response = await fetch(
      "https://crvdae.myshopify.com/admin/api/2026-01/draft_orders.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
        },
        body: JSON.stringify(draftOrder),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors || "Shopify error" });
    }

    const adminUrl = `https://admin.shopify.com/store/crvdae/draft_orders/${data.draft_order.id}`;
    return res.status(200).json({ ok: true, draftOrderId: data.draft_order.id, adminUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
