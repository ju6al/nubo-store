require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const { sendDeliveryEmail } = require("./utils/email");
const products = require("./products");

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory orders (swap for DB in production)
const orders = new Map();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// GET /api/products
app.get("/api/products", (req, res) => {
  const safe = products.map(({ downloadUrl, ...p }) => p);
  res.json(safe);
});

// POST /api/create-payment
app.post("/api/create-payment", async (req, res) => {
  const { productId, customerEmail, customerName } = req.body;
  if (!productId || !customerEmail || !customerName)
    return res.status(400).json({ error: "Missing required fields" });

  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const orderId = uuidv4();

  try {
    const { data } = await axios.post(
      "https://api.nowpayments.io/v1/payment",
      {
        price_amount: product.price,
        price_currency: "usd",
        pay_currency: "btc",
        order_id: orderId,
        order_description: product.name,
        ipn_callback_url: `${process.env.BASE_URL}/api/webhook`,
        success_url: `${process.env.BASE_URL}/success.html?order=${orderId}`,
        cancel_url: `${process.env.BASE_URL}`,
      },
      { headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY, "Content-Type": "application/json" } }
    );

    orders.set(orderId, {
      orderId, productId, customerEmail, customerName,
      status: "pending",
      paymentId: data.payment_id,
      createdAt: new Date().toISOString(),
    });

    console.log(`[ORDER] ${orderId} — ${customerEmail} — ${product.name}`);

    res.json({
      orderId,
      paymentId: data.payment_id,
      payAddress: data.pay_address,
      payAmount: data.pay_amount,
      payCurrency: data.pay_currency,
      paymentUrl: `https://nowpayments.io/payment/?iid=${data.payment_id}`,
      expiresAt: data.expiration_estimate_date,
    });
  } catch (err) {
    console.error("[PAYMENT ERROR]", err?.response?.data || err.message);
    res.status(500).json({ error: "Failed to create payment. Check your NOWPayments API key." });
  }
});

// GET /api/order/:id
app.get("/api/order/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const { customerEmail, ...safe } = order;
  res.json(safe);
});

// POST /api/webhook — NOWPayments IPN
app.post("/api/webhook", async (req, res) => {
  const signature = req.headers["x-nowpayments-sig"];
  const body = req.body;

  const hmac = crypto
    .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
    .update(Buffer.isBuffer(body) ? body : JSON.stringify(body))
    .digest("hex");

  if (hmac !== signature) {
    console.warn("[WEBHOOK] Invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = JSON.parse(Buffer.isBuffer(body) ? body.toString() : JSON.stringify(body));
  const { order_id, payment_status, payment_id } = payload;

  console.log(`[WEBHOOK] ${payment_id} → ${payment_status}`);

  if (!["finished", "confirmed"].includes(payment_status))
    return res.sendStatus(200);

  const order = orders.get(order_id);
  if (!order || order.status === "delivered") return res.sendStatus(200);

  order.status = "delivered";
  order.paidAt = new Date().toISOString();
  orders.set(order_id, order);

  const product = products.find((p) => p.id === order.productId);
  if (!product) return res.sendStatus(200);

  try {
    await sendDeliveryEmail({ to: order.customerEmail, customerName: order.customerName, product, orderId: order_id });
    console.log(`[DELIVERY] Sent to ${order.customerEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }

  res.sendStatus(200);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`\nNubo Store → http://localhost:${PORT}\n`));
