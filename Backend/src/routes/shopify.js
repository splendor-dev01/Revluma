// src/routes/shopify.js
const express = require('express');
const router = express.Router();
const { initiateAuth, authCallback } = require('../controllers/shopifyController');
const authenticate = require('../middleware/auth');

// @route   GET /api/shopify/auth
// @desc    Initiate Shopify OAuth flow
// @access  Private
router.get('/auth', authenticate, initiateAuth);

// @route   GET /api/shopify/auth/callback
// @desc    Shopify OAuth callback
// @access  Public
router.get('/auth/callback', authCallback);

module.exports = router;
