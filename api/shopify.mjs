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
  try {
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
      const addressChanged =
        existing.address1 !== newAddress.address1 ||
        existing.city !== newAddress.city ||
        existing.zip !== newAddress.zip ||
        existing.country_code !== newAddress.country_code;
      if (addressChanged) {
        await shopifyFetch(`/customers/${customer.id}/addresses.json`, "POST", {
          address: { ...newAddress, default: true },
        });
      }
      return customer.id;
    } else {
      const { data: newCustomer } = await shopifyFetch("/customers.json", "POST", {
        customer: {
          first_name: order.first_name || "",
          last_name: order.last_name || "",
          email: order.email,
          phone: order.phone || "",
          verified_email: true,
          addresses: [newAddress],
        },
      });
      return newCustomer.customer?.id || null;
    }
  } catch(e) {
    return null; // Don't fail the whole order if customer lookup fails
  }
}

function extractSize(text) {
  const match = text.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|\d+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function stripSize(text) {
  return text
    .replace(/\s*-\s*size\s+\w+/gi, "")
    .replace(/\b(size|sz)\b/gi, "")
    .replace(/\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*-\s*$/, "")
    .trim();
}

function fuzzyScore(query, title) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const tWords = title.toLowerCase().split(/\s+/);
  if (qWords.length === 0) return 0;
  let score = 0;
  for (const qw of qWords) {
    if (tWords.some(tw => tw.includes(qw) || qw.includes(tw))) score++;
  }
  return score / qWords.length;
}

async function getAllProducts() {
  try {
    const { data } = await shopifyFetch("/products.json?limit=250&fields=id,title,variants");
    return data.products || [];
  } catch(e) {
    return [];
  }
}

async function resolveLineItem(itemText, allProducts) {
  const size = extractSize(itemText);
  const cleanName = stripSize(itemText);

  let bestProduct = null;
  let bestScore = 0;

  for (const product of allProducts) {
    const score = fuzzyScore(cleanName, product.title);
    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  // Use product match if any meaningful overlap (lowered threshold to 0.25)
  if (bestProduct && bestScore >= 0.25) {
    let variant = null;
    if (size) {
      variant = bestProduct.variants.find(v =>
        v.option1?.toUpperCase() === size ||
        v.option2?.toUpperCase() === size ||
        v.title?.toUpperCase().includes(size)
      );
    }
    if (!variant) variant = bestProduct.variants[0];
    return { variant_id: variant.id, quantity: 1 };
  }

  // Fall back to custom line item
  const title = size ? `${cleanName} - Size ${size}` : cleanName;
  return { title, quantity: 1, price: "0.00", requires_shipping: true };
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
    const [customerId, allProducts] = await Promise.all([
      findOrUpdateCustomer(order),
      getAllProducts(),
    ]);

    const items = order.items && order.items.length > 0 ? order.items : ["Gift"];
    const lineItems = await Promise.all(items.map(item => resolveLineItem(item, allProducts)));

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
          title: "Gift",
        },
        note: `Gifting Studio order · ${order.notes || ""}`.trim(),
        tags: "gifting-studio",
      },
    };

    if (customerId) {
      draftOrder.draft_order.customer = { id: customerId };
      draftOrder.draft_order.email = order.email;
    }

    const { status, data } = await shopifyFetch("/draft_orders.json", "POST", draftOrder);

    if (status !== 201) {
      return res.status(status).json({ error: `Shopify ${status}: ${JSON.stringify(data)}` });
    }

    const adminUrl = `https://admin.shopify.com/store/crvdae/draft_orders/${data.draft_order.id}`;
    return res.status(200).json({ ok: true, draftOrderId: data.draft_order.id, adminUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
