const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query, where } = require('firebase/firestore');

// Register a new shop
router.post('/register', async (req, res) => {
  const { name, owner, email, phone, password } = req.body;
  
  if (!password || !name || !owner || !email || !phone) {
    return res.status(400).json({ 
      error: 'All fields (Shop Name, Owner, Email, Phone, Password) are required',
      debug: {
        body: req.body,
        keys: Object.keys(req.body || {}),
        contentType: req.headers['content-type']
      }
    });
  }

  try {
    // Check if email already exists
    const q = query(collection(db, 'shops'), where('email', '==', email));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const docRef = await addDoc(collection(db, 'shops'), {
      name, owner, email, phone, password, status: 'active', createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id, name, owner, email, phone, status: 'active' });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: error.message || 'Failed to register shop' });
  }
});

// Login for shop
router.post('/login', async (req, res) => {
  const { phone, email, password } = req.body;
  const loginId = phone || email;

  if (!loginId || !password) {
    return res.status(400).json({ error: 'Phone/Email and password are required' });
  }

  try {
    // Try to find by phone or email
    const field = phone ? 'phone' : 'email';
    const q = query(collection(db, 'shops'), where(field, '==', loginId));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const shopDoc = snapshot.docs[0];
      const shop = shopDoc.data();
      if (shop.password === password) {
          res.json({ id: shopDoc.id, ...shop });
      } else {
          res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
        res.status(401).json({ error: 'Account not found' });
    }
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

// Get all shops
router.get('/', async (req, res) => {
  try {
    const snapshot = await getDocs(collection(db, 'shops'));
    const shops = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shops' });
  }
});

// Update shop status (active/paused)
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const shopRef = doc(db, 'shops', id);
    await updateDoc(shopRef, { status });
    res.json({ id, status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update shop status' });
  }
});

// Delete a shop
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await deleteDoc(doc(db, 'shops', id));
    res.json({ message: 'Shop deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete shop' });
  }
});

module.exports = router;
