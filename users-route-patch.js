// ─────────────────────────────────────────────────────────────────────────────
// ADD THIS ROUTE to your existing  backend/routes/users.js
// Place it BEFORE the existing  router.get('/', ...)  route
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/users/:id  — fetch a single user by Firestore document ID
router.get('/:id', async (req, res) => {
  try {
    const { db } = require('../firebase');          // adjust path if needed
    const { doc, getDoc } = require('firebase/firestore');

    const ref  = doc(db, 'users', req.params.id);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, otp, ...safe } = snap.data();
    res.json({ id: snap.id, ...safe });
  } catch (err) {
    console.error('GET /users/:id error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: If your routes/users.js already imports db and firestore helpers
// at the top of the file, remove the require() calls inside the handler above
// and use the already-imported versions instead.
// ─────────────────────────────────────────────────────────────────────────────
