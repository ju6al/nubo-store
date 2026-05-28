require('dotenv').config();
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRODUCTS = [
  {
    id: 'nubo-email-scrapper',
    name: 'NUBO EMAIL SCRAPPER',
    tagline: 'Extract emails from anywhere, instantly',
    price: 79,
    currency: 'USD',
    features: ['Scrape emails from any website','Bulk export to CSV or Excel','Built-in duplicate remover','1 year of updates','Priority support','Instant download delivery'],
    downloadLink: 'https://www.dropbox.com/scl/fi/fsu4042n6p2k71ckhcipv/NUBO-EMAIL-BOT.html?rlkey=qlkvozq2royfoeb6jiwhlqd8x&st=0wcafi23&dl=1',
    badge: 'POPULAR',
  }
];

const orders = {};

function generateLicenseKey() {
  const seg = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

function sortObject(obj) {
  return Object.keys(obj).sort().reduce((result, key) => {
    result[key] = obj[key] && typeof obj[key] === 'object' ? sortObject(obj[key]) : obj[key];
    return result;
  }, {});
}

async function sendDeliveryEmail(toEmail, product, licenseKey, orderId) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const html = `<!DOCTYPE html><html><body style="background:#000011;font-family:Inter,Arial,sans-serif;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#00001e;border:1px solid rgba(68,136,255,0.2);border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#000033,#001166);padding:40px;">
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0;">nubo<span style="color:#4d88ff;">.</span>ai</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:6px 0 0;text-transform:uppercase;letter-spacing:1px;">Order Confirmed</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#fff;font-size:20px;margin:0 0 8px;">Your download is ready ✓</h2>
      <p style="color:rgba(255,255,255,0.5);margin:0 0 28px;">Payment confirmed. Here are your details.</p>
      <div style="background:#000033;border:1px solid rgba(68,136,255,0.15);border-radius:8px;padding:20px;margin-bottom:20px;">
        <p style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Product</p>
        <p style="color:#fff;font-size:16px;font-weight:700;margin:0;">${product.name}</p>
      </div>
      <div style="background:#000033;border:1px solid rgba(68,136,255,0.15);border-radius:8px;padding:20px;margin-bottom:20px;">
        <p style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">License Key</p>
        <div style="background:#000011;border:1px solid rgba(68,136,255,0.3);border-radius:6px;padding:14px;text-align:center;">
          <code style="color:#4d88ff;font-size:16px;font-weight:700;letter-spacing:3px;">${licenseKey}</code>
        </div>
      </div>
      <div style="background:#000033;border:1px solid rgba(68,136,255,0.15);border-radius:8px;padding:20px;margin-bottom:28px;">
        <p style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Download</p>
        <a href="${product.downloadLink}" style="display:inline-block;background:#1144ff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;">Download Now</a>
      </div>
      <p style="color:rgba(255,255,255,0.25);font-size:12px;border-top:1px solid rgba(255,255,255,0.05);padding-top:16px;">Order ID: ${orderId} · support@nuboai.com</p>
    </div>
  </div></body></html>`;

  await transporter.sendMail({
    from: `"Nubo AI" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Your ${product.name} download is ready`,
    html,
  });
  console.log(`[+] Email sent to ${toEmail}`);
}

app.get('/api/products', (req, res) => {
  res.json(PRODUCTS.map(({ downloadLink, ...p }) => p));
});

app.post('/api/create-payment', async (req, res) => {
  const { productId, email, payCurrency } = req.body;
  if (!productId || !email) return res.status(400).json({ error: 'productId and email required' });
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const orderId = `nubo_${uuidv4().split('-')[0]}_${Date.now()}`;
  try {
    const response = await axios.post('https://api.nowpayments.io/v1/invoice', {
      price_amount: product.price,
      price_currency: 'usd',
      pay_currency: payCurrency || 'btc',
      order_id: orderId,
      order_description: `${product.name} License`,
      ipn_callback_url: `${process.env.BASE_URL}/api/webhook`,
      success_url: `${process.env.BASE_URL}/success.html?order=${orderId}`,
      cancel_url: `${process.env.BASE_URL}/?cancelled=true`,
    }, { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' } });
    orders[orderId] = { productId, product, email, status: 'pending', createdAt: new Date() };
    console.log(`[+] Order: ${orderId} | ${product.name} | ${email}`);
    res.json({ orderId, invoiceUrl: response.data.invoice_url });
  } catch (err) {
    console.error('Payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment creation failed' });
  }
});

app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['x-nowpayments-sig'];
  if (sig && process.env.NOWPAYMENTS_IPN_SECRET) {
    const sorted = JSON.stringify(sortObject(req.body));
    const expected = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET).update(sorted).digest('hex');
    if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  }
  const { payment_status, order_id } = req.body;
  console.log(`[webhook] ${order_id} | ${payment_status}`);
  if ((payment_status === 'confirmed' || payment_status === 'finished') && order_id) {
    const order = orders[order_id];
    if (order && order.status === 'pending') {
      try {
        const licenseKey = generateLicenseKey();
        order.status = 'completed';
        await sendDeliveryEmail(order.email, order.product, licenseKey, order_id);
        console.log(`[✓] Fulfilled: ${order_id}`);
      } catch (e) {
        console.error('Email failed:', e.message);
      }
    }
  }
  res.status(200).json({ received: true });
});

app.get('/api/order/:orderId', (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json({ orderId: req.params.orderId, status: order.status });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Nubo Store running on port ${PORT}`));
