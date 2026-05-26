const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { collection, addDoc, getDocs, getDoc, doc, updateDoc, setDoc, query, where } = require('firebase/firestore');
const https = require('https');
const twilio = require('twilio');

// Helper function to send SMS via Twilio (if configured) or Textbelt (fallback)
async function sendRealtimeSMS(phone, message) {
  let formattedPhone = phone;
  if (!phone.startsWith('+')) {
    if (phone.length === 10) {
      formattedPhone = '+91' + phone;
    } else {
      formattedPhone = '+' + phone;
    }
  }

  // 1. Try sending via Twilio if environment variables are set
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      console.log(`[SMS] Attempting to send message via Twilio to ${formattedPhone}...`);
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const response = await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone
      });
      console.log(`[SMS] Twilio message sent successfully. SID: ${response.sid}`);
      return { success: true, sid: response.sid };
    } catch (err) {
      console.error('[SMS] Twilio failed:', err.message);
      // Fallback to textbelt if twilio config is present but fails
    }
  }

  // 2. Fallback to Textbelt API
  return new Promise((resolve) => {
    console.log(`[SMS] Attempting fallback to Textbelt for ${formattedPhone}...`);
    const data = JSON.stringify({
      phone: formattedPhone,
      message: message,
      key: 'textbelt' // Free tier API key
    });

    const options = {
      hostname: 'textbelt.com',
      port: 443,
      path: '/text',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse response' });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.write(data);
    req.end();
  });
}

// User Signup Endpoint
router.post('/signup', async (req, res) => {
  const { name, phone, address, role, password } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'Name, phone, and password are required' });
  }

  try {
    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snapshot = await getDocs(q);

    // Generate a random 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    let user = { name, phone, address: address || '', password, role: role || 'customer', otp, isVerified: false };
    
    if (!snapshot.empty) {
      const existingUserDoc = snapshot.docs[0];
      const existingUser = existingUserDoc.data();
      
      if (existingUser.isVerified) {
        return res.status(400).json({ error: 'User with this phone number already exists and is verified.' });
      }
      // If user exists but is not verified, update their OTP and password
      await updateDoc(doc(db, 'users', existingUserDoc.id), user);
    } else {
      // Create new unverified user
      await addDoc(collection(db, 'users'), {
          ...user,
          createdAt: new Date().toISOString()
      });
    }

    const smsMessage = `Your Quick door verification OTP is ${otp}`;
    
    // Attempt to send real-time SMS
    const smsResult = await sendRealtimeSMS(phone, smsMessage);
    
    // Output OTP to terminal console prominently for debugging/fallback
    console.log('\n==========================================');
    console.log(`[REAL-TIME SMS] Sent to: ${phone}`);
    console.log(`[REAL-TIME SMS] Message: "${smsMessage}"`);
    console.log(`[REAL-TIME SMS] API Response:`, smsResult);
    console.log('==========================================\n');

    res.status(201).json({
      message: 'Signup initiated. OTP sent to your phone.',
      phone: user.phone,
      debugOtp: otp, // Including debugOtp in the payload so the UI can fallback or display it
      smsStatus: smsResult.success ? 'sent' : 'failed_fallback_to_console'
    });

  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ error: 'Failed to process signup request' });
  }
});

// Verify OTP Endpoint
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  try {
    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    if (user.otp === otp) {
      // Mark user as verified
      await updateDoc(doc(db, 'users', userDoc.id), { isVerified: true, otp: null });
      res.json({ message: 'Phone verified successfully!', user: { id: userDoc.id, ...user, isVerified: true, otp: null } });
    } else {
      res.status(400).json({ error: 'Invalid OTP. Please check the OTP sent to your phone.' });
    }

  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// User Login Endpoint
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required' });
  }

  try {
    const q = query(collection(db, 'users'), where('phone', '==', phone));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    if (!user.isVerified) {
      return res.status(400).json({ error: 'Please verify your phone number before logging in.' });
    }

    if (user.password === password) {
      res.json({ message: 'Login successful', user: { id: userDoc.id, ...user } });
    } else {
      res.status(400).json({ error: 'Invalid password' });
    }

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Get all users
router.get('/', async (req, res) => {
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    const users = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      name: doc.data().name,
      phone: doc.data().phone,
      address: doc.data().address,
      role: doc.data().role,
      isVerified: doc.data().isVerified,
      createdAt: doc.data().createdAt
    }));
    res.json(users);
  } catch (error) {
    console.error('Fetch Users Error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const userDoc = await getDoc(doc(db, 'users', id));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      delete userData.password;
      delete userData.otp;
      res.json({ id: userDoc.id, ...userData });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Fetch User Error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
