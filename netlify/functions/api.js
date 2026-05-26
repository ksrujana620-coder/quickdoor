require('dotenv').config();
const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

app.use(cors());
// Use standard body-parser logic
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

// Middleware to handle cases where req.body is not parsed (common in some serverless setups)
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!req.body || Object.keys(req.body).length === 0) {
      // Check if serverless-http provided rawBody
      if (req.rawBody) {
        try {
          req.body = JSON.parse(req.rawBody.toString());
        } catch (e) {}
      }
      
      // If body is still empty and it's a string, try to parse it
      if ((!req.body || Object.keys(req.body).length === 0) && typeof req.body === 'string' && req.body.trim().startsWith('{')) {
        try {
          req.body = JSON.parse(req.body);
        } catch (e) {}
      }
    }
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// TEST ROUTE to check body arrival
app.post('/test-body', (req, res) => {
  res.json({ 
    bodyReceived: req.body, 
    bodyKeys: Object.keys(req.body || {}),
    contentType: req.headers['content-type']
  });
});

// Import routes from backend folder
const productsRoute = require('../../backend/routes/products');
const ordersRoute = require('../../backend/routes/orders');
const usersRoute = require('../../backend/routes/users');
const shopsRoute = require('../../backend/routes/shops');

const apiRouter = express.Router();

apiRouter.use('/products', productsRoute);
apiRouter.use('/orders', ordersRoute);
apiRouter.use('/users', usersRoute);
apiRouter.use('/shops', shopsRoute);

// Mount the router
// On Netlify, requests to /api/* are redirected to /.netlify/functions/api/*
// Express sees the full path including the prefix.
app.use('/.netlify/functions/api', apiRouter);
app.use('/api', apiRouter);
app.use('/', apiRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports.handler = serverless(app, {
  // Force parsing of binary/raw body
  binary: true
});
