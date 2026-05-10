/**
 * NuMind MAPS — Admin Server
 */

'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');

const PORT           = process.env.PORT || process.env.ADMIN_PORT;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!process.env.DB_PATH)   throw new Error('DB_PATH is not set');
if (!PORT)                  throw new Error('PORT / ADMIN_PORT is not set');
if (!SESSION_SECRET)        throw new Error('SESSION_SECRET is not set');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
}));

// ── Routes ────────────────────────────────────────────────────────
const { requireAuth } = require('./middleware/auth');
const authRouter      = require('./routes/auth');
const apiRouter       = require('./routes/api');

app.use('/auth', authRouter);
app.use('/api',  requireAuth, apiRouter);

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NuMind MAPS  →  http://localhost:${PORT}`);
  console.log(`Database     →  ${process.env.DB_PATH}`);
});

module.exports = app;
