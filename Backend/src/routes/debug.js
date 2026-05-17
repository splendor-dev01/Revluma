const express = require('express');
const logger = require('../utils/logger');
const { validateSession } = require('../middleware/sessionAuth');
const { prisma } = require('../services/prisma');

const router = express.Router();

router.get('/session-check', async (req, res) => {
    try {
        const sessionAuth = await validateSession(req, res);
        if (!sessionAuth) {
            return res.status(200).json({ session: null, authenticated: false });
        }

        return res.status(200).json({
            session: {
                token: sessionAuth.token,
                expiresAt: sessionAuth.expiresAt
            },
            user: sessionAuth.user,
            authenticated: true,
            verified: sessionAuth.verified
        });
    } catch (err) {
        logger.error('Debug session-check failed', { error: err.message });
        return res.status(500).json({ error: 'Debug session-check failed' });
    }
});

module.exports = router;
