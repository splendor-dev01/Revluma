const jwt = require('jsonwebtoken');

const authenticatePending = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Pending registration token required' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            ignoreExpiration: false
        });

        if (!decoded.pendingRegistrationId || !decoded.email || decoded.type !== 'pending_registration') {
            throw new Error('Invalid pending registration token');
        }

        req.pending = {
            id: decoded.pendingRegistrationId,
            email: decoded.email
        };

        next();
    } catch (err) {
        const status = err.name === 'TokenExpiredError' ? 401 : 401;
        return res.status(status).json({ error: 'Invalid or expired pending registration token' });
    }
};

const createPendingToken = (pendingRegistrationId, email) => {
    return jwt.sign(
        {
            pendingRegistrationId,
            email,
            type: 'pending_registration'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
    );
};

module.exports = {
    authenticatePending,
    createPendingToken
};