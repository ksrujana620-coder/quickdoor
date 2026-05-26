// netlify/functions/api.js
// This is the SINGLE serverless function that handles ALL /api/* routes on Netlify.
// It uses Firebase Firestore as the database (no SQLite - Netlify is read-only filesystem).

const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp
} = require('firebase/firestore');

// ── Firebase init (reuse across warm invocations) ──────────────────────────
const firebaseConfig = {
  apiKey:            process.env.FIREBASE_API_KEY            || "AIzaSyB6yedH7WPFidqfifEQjKvOss-rzpqv__A",
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || "quickvillageservice.firebaseapp.com",
  projectId:         process.env.FIREBASE_PROJECT_ID         || "quickvillageservice",
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || "quickvillageservice.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID|| "453085397164",
  appId:             process.env.FIREBASE_APP_ID             || "1:453085397164:web:76c3e89cfdfeb4edbb1f09"
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(firebaseApp);

// ── Helpers ────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function sendSms(phone, message) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || sid.startsWith('AC_') || sid === 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') {
    console.log(`[SMS SKIPPED - no Twilio] To: ${phone} | Msg: ${message}`);
    return { status: 'skipped' };
  }
  try {
    const twilio = require('twilio')(sid, token);
    await twilio.messages.create({ body: message, from, to: `+91${phone}` });
    return { status: 'sent' };
  } catch (err) {
    console.error('Twilio error:', err.message);
    return { status: 'failed', error: err.message };
  }
}

// ── Express app ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ══════════════════════════════════════════════════════════════════════════
// USERS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// POST /users/signup
app.post('/users/signup', async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'Name, phone, and password are required' });
    }

    // Check duplicate phone
    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const otp = generateOtp();
    const userData = {
      name, phone, password, role: role || 'customer',
      otp, isVerified: false,
      createdAt: Timestamp.now()
    };

    const ref = await addDoc(collection(db, 'users'), userData);

    // Try SMS
    const smsResult = await sendSms(phone, `Your Quick door OTP is: ${otp}`);
    const smsStatus = smsResult.status === 'sent' ? 'sent' : 'failed_fallback_to_console';

    res.status(201).json({
      message: 'User created. OTP sent.',
      smsStatus,
      debugOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// POST /users/verify-otp
app.post('/users/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (snap.empty) return res.status(404).json({ error: 'User not found' });

    const docRef = snap.docs[0];
    const user = { id: docRef.id, ...docRef.data() };

    if (user.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

    await updateDoc(doc(db, 'users', docRef.id), { isVerified: true, otp: null });

    const { password, otp: _, ...safeUser } = user;
    res.json({ message: 'Phone verified', user: { ...safeUser, isVerified: true } });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /users/login
app.post('/users/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (snap.empty) return res.status(401).json({ error: 'Invalid credentials' });

    const docRef = snap.docs[0];
    const user = { id: docRef.id, ...docRef.data() };

    if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, otp: __, ...safeUser } = user;
    res.json({ message: 'Login successful', user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /users/:id  — fetch a single user by Firestore doc ID
app.get('/users/:id', async (req, res) => {
  try {
    const ref = doc(db, 'users', req.params.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ error: 'User not found' });
    const { password, otp, ...safe } = snap.data();
    res.json({ id: snap.id, ...safe });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /users
app.get('/users', async (req, res) => {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => {
      const { password, otp, ...safe } = d.data();
      return { id: d.id, ...safe };
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SHOPS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /shops
app.get('/shops', async (req, res) => {
  try {
    const snap = await getDocs(collection(db, 'shops'));
    const shops = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(shops);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shops/register
app.post('/shops/register', async (req, res) => {
  try {
    const { name, owner, email, phone, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const q = query(collection(db, 'shops'), where('email', '==', email));
    const snap = await getDocs(q);
    if (!snap.empty) return res.status(409).json({ error: 'Email already registered' });

    const shopData = {
      name, owner: owner || '', email, phone: phone || '',
      password, status: 'active',
      createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'shops'), shopData);
    const { password: _, ...safe } = shopData;
    res.status(201).json({ id: ref.id, ...safe });
  } catch (err) {
    console.error('Shop register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shops/login
app.post('/shops/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const q = query(collection(db, 'shops'), where('email', '==', email));
    const snap = await getDocs(q);
    if (snap.empty) return res.status(401).json({ error: 'Invalid credentials' });

    const docRef = snap.docs[0];
    const shop = { id: docRef.id, ...docRef.data() };
    if (shop.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, ...safe } = shop;
    res.json({ ...safe });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /shops/seed
app.post('/shops/seed', async (req, res) => {
  try {
    const { name, owner, email, phone } = req.body;
    const shopData = {
      name, owner: owner || '', email: email || '',
      phone: phone || '', password: 'seed123',
      status: 'active', createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'shops'), shopData);
    res.status(201).json({ id: ref.id, ...shopData });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /shops/:id/status
app.patch('/shops/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await updateDoc(doc(db, 'shops', req.params.id), { status });
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /shops/:id
app.delete('/shops/:id', async (req, res) => {
  try {
    await deleteDoc(doc(db, 'shops', req.params.id));
    res.json({ message: 'Shop deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PRODUCTS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /products
app.get('/products', async (req, res) => {
  try {
    const { shopId } = req.query;
    let q = collection(db, 'products');
    if (shopId) {
      q = query(q, where('shopId', '==', shopId));
    }
    const snap = await getDocs(q);
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/:id
app.get('/products/:id', async (req, res) => {
  try {
    const ref = doc(db, 'products', req.params.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ error: 'Product not found' });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /products
app.post('/products', async (req, res) => {
  try {
    const { name, price, category, stock, image, shopId } = req.body;
    if (!name || price === undefined || !shopId) {
      return res.status(400).json({ error: 'Name, price, and shopId are required' });
    }
    const productData = {
      name, price: Number(price),
      category: category || 'General',
      stock: Number(stock) || 0,
      image: image || '',
      shopId, createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'products'), productData);
    res.status(201).json({ id: ref.id, ...productData });
  } catch (err) {
    console.error('Add product error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /products/:id
app.delete('/products/:id', async (req, res) => {
  try {
    await deleteDoc(doc(db, 'products', req.params.id));
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ORDERS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /orders
app.get('/orders', async (req, res) => {
  try {
    const { customerId } = req.query;
    let q = collection(db, 'orders');
    if (customerId) {
      q = query(q, where('customerId', '==', customerId));
    }
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/stats  (per-shop delivery stats)
app.get('/orders/stats', async (req, res) => {
  try {
    const snap = await getDocs(collection(db, 'orders'));
    const stats = {};
    snap.docs.forEach(d => {
      const o = d.data();
      // Get shopId from product lookup would be ideal, but we store it on order if available
      const key = o.shopId || 'unknown';
      if (!stats[key]) stats[key] = { totalOrders: 0, deliveredOrders: 0, pendingOrders: 0 };
      stats[key].totalOrders++;
      if (o.status === 'delivered') stats[key].deliveredOrders++;
      else stats[key].pendingOrders++;
    });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders
app.post('/orders', async (req, res) => {
  try {
    const { productId, quantity, customerId, paymentMethod } = req.body;
    if (!productId || !quantity) {
      return res.status(400).json({ error: 'productId and quantity are required' });
    }

    // Get shop from product
    let shopId = null;
    try {
      const productSnap = await getDoc(doc(db, 'products', productId));
      if (productSnap.exists()) shopId = productSnap.data().shopId || null;
    } catch (_) {}

    const otp = generateOtp();
    const orderData = {
      productId, quantity: Number(quantity),
      customerId: customerId || 'guest',
      shopId,
      paymentMethod: paymentMethod || 'COD',
      otp, status: 'pending',
      createdAt: Timestamp.now()
    };

    const ref = await addDoc(collection(db, 'orders'), orderData);

    // Notify shop owner via SMS if possible
    if (shopId) {
      try {
        const shopSnap = await getDocs(query(collection(db, 'shops'), where('__name__', '==', shopId)));
        // simplified: skip SMS notification for now
      } catch (_) {}
    }

    res.status(201).json({ id: ref.id, ...orderData });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders/verify-otp
app.post('/orders/verify-otp', async (req, res) => {
  try {
    const { orderId, otp } = req.body;
    if (!orderId || !otp) return res.status(400).json({ error: 'orderId and otp required' });

    const ref = doc(db, 'orders', orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ error: 'Order not found' });

    const order = snap.data();
    if (order.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (order.status === 'delivered') return res.status(400).json({ error: 'Already delivered' });

    await updateDoc(ref, { status: 'delivered', deliveredAt: Timestamp.now() });
    res.json({ message: 'Delivery confirmed', orderId });
  } catch (err) {
    console.error('Verify delivery OTP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

module.exports.handler = serverless(app, {
  basePath: '/api'
});
