const express = require('express');
const router = express.Router();
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

// POST /api/delivery-boys/register  — shop owner creates a delivery boy account
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, shopId, area, vehicle } = req.body;
    if (!name || !phone || !password || !shopId) {
      return res.status(400).json({ error: 'name, phone, password, and shopId are required' });
    }

    // Prevent duplicate phone
    const q = query(collection(db, 'deliveryBoys'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return res.status(409).json({ error: 'A delivery boy with this phone number already exists' });
    }

    const data = {
      name, phone, password, shopId,
      area: area || '',
      vehicle: vehicle || '',
      status: 'active',
      role: 'deliveryboy',
      createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'deliveryBoys'), data);
    const { password: _, ...safe } = data;
    res.status(201).json({ id: ref.id, ...safe });
  } catch (err) {
    console.error('Delivery boy register error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// POST /api/delivery-boys/login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }

    const q = query(collection(db, 'deliveryBoys'), where('phone', '==', phone));
    const snap = await getDocs(q);
    if (snap.empty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const docRef = snap.docs[0];
    const boy = { id: docRef.id, ...docRef.data() };

    if (boy.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (boy.status !== 'active') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact your shop owner.' });
    }

    const { password: _, ...safe } = boy;
    res.json({ message: 'Login successful', deliveryBoy: safe });
  } catch (err) {
    console.error('Delivery boy login error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/delivery-boys?shopId=xxx
router.get('/', async (req, res) => {
  try {
    const { shopId } = req.query;
    let q = collection(db, 'deliveryBoys');
    if (shopId) q = query(q, where('shopId', '==', shopId));
    const snap = await getDocs(q);
    const list = snap.docs.map(d => {
      const { password, ...safe } = d.data();
      return { id: d.id, ...safe };
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// PATCH /api/delivery-boys/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await updateDoc(doc(db, 'deliveryBoys', req.params.id), { status });
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// DELETE /api/delivery-boys/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteDoc(doc(db, 'deliveryBoys', req.params.id));
    res.json({ message: 'Delivery boy removed' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;
