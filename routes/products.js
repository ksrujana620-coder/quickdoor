const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { collection, addDoc, getDocs, getDoc, doc, deleteDoc, query, where, updateDoc } = require('firebase/firestore');

// Get all products (optionally filtered by shopId)
router.get('/', async (req, res) => {
  const { shopId } = req.query;
  try {
    let productsQuery = collection(db, 'products');
    if (shopId) {
      productsQuery = query(productsQuery, where('shopId', '==', shopId));
    }
    const snapshot = await getDocs(productsQuery);
    let products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // If no shopId is provided, we only want products from active shops
    if (!shopId) {
      // For a scalable app, it's better to store shopStatus on the product document
      // Here we will fetch active shops and filter products in memory
      const shopsSnapshot = await getDocs(query(collection(db, 'shops'), where('status', '==', 'active')));
      const activeShopIds = shopsSnapshot.docs.map(doc => doc.id);
      products = products.filter(p => activeShopIds.includes(p.shopId));
    }

    res.json(products);
  } catch (error) {
    console.error('Fetch Products Error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get a single product
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const productDoc = await getDoc(doc(db, 'products', id));
    if (productDoc.exists()) {
      res.json({ id: productDoc.id, ...productDoc.data() });
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Add a product
router.post('/', async (req, res) => {
  const { name, price, category, stock, image, shopId } = req.body;
  
  if (!shopId) {
    return res.status(400).json({ error: 'Shop ID is required' });
  }

  try {
    const shopDoc = await getDoc(doc(db, 'shops', shopId));
    
    if (!shopDoc.exists()) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    const shopData = shopDoc.data();
    if (shopData.status === 'paused') {
      return res.status(400).json({ error: 'Failed to add product. Your shop is paused by the administrator.' });
    }

    const docRef = await addDoc(collection(db, 'products'), {
      name, 
      price: parseInt(price) || 0, 
      category, 
      stock: parseInt(stock) || 0, 
      image: image || '', 
      shopId,
      createdAt: new Date().toISOString()
    });
    
    res.status(201).json({
      id: docRef.id, name, price: parseInt(price) || 0, category, stock: parseInt(stock) || 0, image: image || '', shopId
    });
  } catch (error) {
    console.error('Create Product Error:', error);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

// Delete a product
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await deleteDoc(doc(db, 'products', id));
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Update a product (e.g., for stock)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { stock, price, name, category, image } = req.body;
  
  console.log(`[API] Updating product ${id} with:`, req.body);
  
  try {
    const productRef = doc(db, 'products', id);
    const productDoc = await getDoc(productRef);
    
    if (!productDoc.exists()) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updateData = {};
    if (stock !== undefined) updateData.stock = parseInt(stock) || 0;
    if (price !== undefined) updateData.price = parseInt(price) || 0;
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (image !== undefined) updateData.image = image;

    await updateDoc(productRef, updateData);
    
    res.json({ message: 'Product updated successfully', id, ...updateData });
  } catch (error) {
    console.error('Update Product Error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

module.exports = router;
