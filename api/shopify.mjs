const SHOP = "crvdae.myshopify.com";
const API = "2026-01";

async function shopifyFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://${SHOP}/admin/api/${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function findOrUpdateCustomer(order) {
  if (!order.email) return null;

  // Search for existing customer by email
  const { data: searchData } = await shopifyFetch(
    `/customers/search.json?query=email:${encodeURIComponent(order.email)}&limit=1`
  );

  const newAddress = {
    address1: order.address_line1 || "",
    city: order.city || "",
    zip: order.postcode || "",
    country_code: order.country_code || "",
    country: order.country || "",
    phone: order.phone || "",
    first_name: order.first_name || "",
    last_name: order.last_name || "",
  };

  if (searchData.customers && searchData.customers.length > 0) {
    const customer = searchData.customers[0];
    const existing = customer.default_address || {};

    // Check if address is different
    const addressChanged =
      existing.address1 !== newAddress.address1 ||
      existing.city !== newAddress.city ||
      existing.zip !== newAddress.zip ||
      existing.country_code !== newAddress.country_code;

    if (addressChanged) {
      // Add new address to customer
      await shopifyFetch(`/customers/${customer.id}/addresses.json`, "POST", {
        address: { ...newAddress, default: true },
      });
    }

    return customer.id;
  } else {
    // Create new customer
    const { data: newCustomer } = await shopifyFetch("/customers.json", "POST", {
      customer: {
        first_name: order.first_name || "",
        last_name: order.last_name || "",
        email: order.email,
        phone: order.phone || "",
        addresses: [newAddress],
      },
    });
    return newCustomer.customer?.id || null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password, order } = req.body;
  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const customerId = await findOrUpdateCustomer(order);

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
          country: order.country || "",
          phone: order.phone || "",
        },
        applied_discount: {
          description: "Gift",
          value_type: "percentage",
          value: "100.0",
          amount: "100.0",
          title: "Gift",
        },
        note: `Gifting Studio order · ${order.notes || ""}`.trim(),
        tags: "gifting-studio",
      },
    };

    // Attach customer if found/created
    if (customerId) {
      draftOrder.draft_order.customer = { id: customerId };
      draftOrder.draft_order.email = order.email;
    }

    const { status, data } = await shopifyFetch("/draft_orders.json", "POST", draftOrder);

    if (status !== 201) {
      return res.status(status).json({ error: data.errors || "Shopify error" });
    }

    const adminUrl = `https://admin.shopify.com/store/crvdae/draft_orders/${data.draft_order.id}`;
    return res.status(200).json({ ok: true, draftOrderId: data.draft_order.id, adminUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
