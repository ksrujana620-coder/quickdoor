const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { collection, addDoc, getDocs, getDoc, doc, updateDoc, query, where } = require('firebase/firestore');
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

// Lazy-init: only create client when credentials are real (not placeholders)
let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient) {
    const isRealSid = accountSid && accountSid.startsWith('AC') && accountSid.length > 10;
    const isRealToken = authToken && authToken !== 'your_auth_token_here' && authToken.length > 10;
    if (isRealSid && isRealToken) {
      try {
        twilioClient = twilio(accountSid, authToken);
      } catch (e) {
        console.error('Twilio init failed:', e.message);
      }
    }
  }
  return twilioClient;
}

// Helper function to send events to the n8n webhook
async function sendN8NWebhook(eventType, eventData) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data: eventData
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      console.log(`[n8n Webhook] Successfully sent ${eventType} event.`);
    } else {
      console.error(`[n8n Webhook] Failed to send ${eventType} event. Status: ${response.status}`);
    }
  } catch (error) {
    console.error(`[n8n Webhook] Error sending ${eventType} event:`, error);
  }
}

// Create an order
router.post('/', async (req, res) => {
  const { productId, quantity, customerId, customerName, customerPhone, customerAddress } = req.body;
  const qtyNum = parseInt(quantity);

  if (!productId || isNaN(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ error: 'Valid productId and quantity are required' });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    // 1. Fetch the product to get shopId AND check/update stock
    let shopId = '';
    let shopPhone = '';
    const productRef = doc(db, 'products', productId);
    const productDoc = await getDoc(productRef);
    
    if (!productDoc.exists()) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const productData = productDoc.data();
    shopId = productData.shopId || '';
    const currentStock = parseInt(productData.stock) || 0;

    // 2. Check if enough stock is available
    if (currentStock < qtyNum) {
      return res.status(400).json({ 
        error: `Insufficient stock. Only ${currentStock} available.` 
      });
    }

    // 3. Decrease the stock in Firestore
    await updateDoc(productRef, {
      stock: currentStock - qtyNum
    });

    // 4. Create the order
    const docRef = await addDoc(collection(db, 'orders'), {
      productId,
      quantity: qtyNum,
      customerId: customerId || 'guest',
      customerName: customerName || 'Guest',
      customerPhone: customerPhone || '',
      customerAddress: customerAddress || '',
      shopId,
      otp,
      status: 'pending',
      paymentMethod: 'COD',
      createdAt: new Date().toISOString()
    });

    // Fetch shop phone number for SMS notification
    if (shopId) {
      const shopDoc = await getDoc(doc(db, 'shops', shopId));
      if (shopDoc.exists()) {
        shopPhone = shopDoc.data().phone || '';
      }
    }

    // Send SMS to shop owner if phone is available and Twilio is configured
    if (shopPhone) {
      const client = getTwilioClient();
      if (client) {
        const messageBody = `Quick door: New order received!\nOrder ID: ${docRef.id}\nProduct ID: ${productId}\nQty: ${quantity}\nOTP: ${otp}\nCustomer ID: ${customerId || 'guest'}`;
        try {
          await client.messages.create({
            body: messageBody,
            from: twilioPhone,
            to: shopPhone
          });
          console.log('SMS sent to shop owner', shopPhone);
        } catch (smsErr) {
          console.error('Failed to send SMS:', smsErr.message);
        }
      } else {
        console.log('[SMS] Twilio not configured. Skipping SMS notification.');
      }
    }

    // Trigger order confirmation event on n8n webhook (non-blocking)
    sendN8NWebhook('order', {
      orderId: docRef.id,
      productId,
      quantity: parseInt(quantity),
      customerId: customerId || 'guest',
      shopId,
      otp,
      status: 'pending',
      paymentMethod: 'COD',
      createdAt: new Date().toISOString()
    }).catch(err => console.error('n8n webhook error:', err));

    res.status(201).json({
      id: docRef.id,
      productId,
      quantity: parseInt(quantity),
      customerId: customerId || 'guest',
      shopId,
      otp,
      status: 'pending',
      paymentMethod: 'COD'
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify OTP and complete delivery
router.post('/verify-otp', async (req, res) => {
  const { orderId, otp } = req.body;

  if (!orderId || !otp) {
    return res.status(400).json({ error: 'orderId and otp are required' });
  }

  try {
    const orderDoc = await getDoc(doc(db, 'orders', orderId));
    if (!orderDoc.exists()) return res.status(404).json({ error: 'Order not found' });

    const order = orderDoc.data();

    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Order is not pending' });
    }

    const providedOtp = String(otp).trim();
    const storedOtp = String(order.otp).trim();
    const otpMatches = providedOtp === storedOtp && storedOtp !== '';

    if (otpMatches) {
      await updateDoc(doc(db, 'orders', orderId), { status: 'delivered', otp: '' });
      const updatedOrder = { ...order, status: 'delivered', otp: '' };

      // Trigger delivery confirmation event on n8n webhook (non-blocking)
      sendN8NWebhook('delivery', {
        orderId,
        productId: order.productId,
        quantity: parseInt(order.quantity),
        customerId: order.customerId,
        shopId: order.shopId,
        status: 'delivered',
        deliveredAt: new Date().toISOString()
      }).catch(err => console.error('n8n webhook error:', err));

      res.json({ message: 'Delivery confirmed!', order: { id: orderDoc.id, ...updatedOrder } });
    } else {
      res.status(400).json({ error: 'Invalid OTP' });
    }
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get delivery stats per shop
router.get('/stats', async (req, res) => {
  try {
    // Fetch shops and products to filter out orphans
    const [shopsSnap, productsSnap, ordersSnap] = await Promise.all([
      getDocs(collection(db, 'shops')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'orders'))
    ]);

    const existingShopIds = new Set(shopsSnap.docs.map(d => d.id));
    const existingProductIds = new Set(productsSnap.docs.map(d => d.id));
    const orders = ordersSnap.docs.map(d => d.data());

    const stats = {};
    orders.forEach(order => {
      const sid = order.shopId || 'unknown';
      const pid = order.productId;

      // Skip if shop or product no longer exists
      if (!existingShopIds.has(sid) || !existingProductIds.has(pid)) {
        return;
      }

      if (!stats[sid]) {
        stats[sid] = { totalOrders: 0, deliveredOrders: 0, pendingOrders: 0 };
      }
      stats[sid].totalOrders++;
      if (order.status === 'delivered') {
        stats[sid].deliveredOrders++;
      } else {
        stats[sid].pendingOrders++;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ error: 'Failed to fetch order stats' });
  }
});

// Get all orders (optionally filtered)
router.get('/', async (req, res) => {
  const { productId, shopId, customerId, deliveryBoyId } = req.query;
  try {
    let ordersQuery = collection(db, 'orders');
    let constraints = [];

    if (productId) constraints.push(where('productId', '==', productId));
    if (shopId) constraints.push(where('shopId', '==', shopId));
    if (customerId) constraints.push(where('customerId', '==', customerId));
    if (deliveryBoyId) constraints.push(where('deliveryBoyId', '==', deliveryBoyId));

    if (constraints.length > 0) {
      ordersQuery = query(ordersQuery, ...constraints);
    }

    const snapshot = await getDocs(ordersQuery);
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (error) {
    console.error('Fetch Orders Error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Assign delivery boy to order
router.patch('/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { deliveryBoyId } = req.body;

  try {
    const orderRef = doc(db, 'orders', id);
    const orderDoc = await getDoc(orderRef);
    if (!orderDoc.exists()) return res.status(404).json({ error: 'Order not found' });

    await updateDoc(orderRef, { deliveryBoyId });
    res.json({ message: 'Delivery boy assigned', orderId: id, deliveryBoyId });
  } catch (error) {
    console.error('Assign Delivery Boy Error:', error);
    res.status(500).json({ error: 'Failed to assign delivery boy' });
  }
});

module.exports = router;
