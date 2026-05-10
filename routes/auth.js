'use strict';

const express = require('express');
const router  = express.Router();

const ADMIN_USER = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.admin = { username };
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /auth/me — lets the frontend check session on reload
router.get('/me', (req, res) => {
  if (req.session && req.session.admin) {
    return res.json({ admin: req.session.admin.username });
  }
  res.status(401).json({ error: 'Not logged in' });
});

module.exports = router;
