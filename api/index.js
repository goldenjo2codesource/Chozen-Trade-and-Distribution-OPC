require('dotenv').config();

const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-auth-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Database (PostgreSQL required on Vercel) ──
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS verifications (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL);
  `);
}
initDB().catch(e => console.error('DB init error:', e.message));

// ── DB Helpers ──
async function dbGetAll(table) {
  const r = await db.query(`SELECT data FROM ${table} ORDER BY created_at ASC`);
  return r.rows.map(r => r.data);
}
async function dbGetOne(table, id) {
  const r = await db.query(`SELECT data FROM ${table} WHERE id=$1`, [id]);
  return r.rows[0]?.data || null;
}
async function dbUpsert(table, item) {
  await db.query(`INSERT INTO ${table}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`, [item.id, item]);
}
async function dbDelete(table, id) {
  await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
}

// ── Sessions ──
function genToken() { return crypto.randomBytes(32).toString('hex'); }

async function createSession(token, userId, role) {
  const expires = Date.now() + 604800000;
  await db.query(`INSERT INTO sessions(token,user_id,role,expires) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO UPDATE SET expires=$4`, [token, userId, role, expires]);
}

async function getSession(req) {
  const token = req.headers['x-auth-token'] || '';
  if (!token) return null;
  try {
    const r = await db.query(`SELECT user_id,role,expires FROM sessions WHERE token=$1`, [token]);
    if (!r.rows.length) return null;
    const s = r.rows[0];
    if (parseInt(s.expires) < Date.now()) {
      await db.query(`DELETE FROM sessions WHERE token=$1`, [token]);
      return null;
    }
    return { userId: s.user_id, role: s.role };
  } catch(e) { return null; }
}

// ── Mail ──
const MAIL_ENABLED    = process.env.MAIL_ENABLED === 'true';
const RESEND_API_KEY  = process.env.RESEND_API_KEY || '';
const MAILJET_API_KEY = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET  = process.env.MAILJET_SECRET || '';
const ADMIN_EMAIL     = process.env.ADMIN_EMAIL || 'admin@chozentrade.com';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || 'Admin@CT2026';
const ADMIN_EMAIL_LIST = (process.env.ADMIN_EMAIL_LIST || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const APP_URL         = process.env.APP_URL || 'https://chozen-trade.vercel.app';

async function sendMail(to, subject, html) {
  if (!MAIL_ENABLED) return;
  try {
    if (MAILJET_API_KEY && MAILJET_SECRET) {
      const Mailjet = require('node-mailjet');
      const mj = Mailjet.apiConnect(MAILJET_API_KEY, MAILJET_SECRET);
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{ From: { Email: process.env.MAIL_USER || 'info@chozentrade.com', Name: 'Chozen Trade & Distribution' }, To: [{ Email: to }], Subject: subject, HTMLPart: html }]
      });
    } else if (RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({ from: 'Chozen Trade <onboarding@resend.dev>', to, subject, html });
    }
  } catch(e) { console.error('Mail error:', e.message); }
}

// ── Routes ──

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const users = await dbGetAll('users');
    const existing = users.find(u => u.email === email.toLowerCase());
    if (existing) {
      if (MAIL_ENABLED && existing.verified === false) await dbDelete('users', existing.id);
      else return res.status(409).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const isAdmin = ADMIN_EMAIL_LIST.includes(email.toLowerCase());
    const newUser = { id: Date.now().toString(), createdAt: new Date().toISOString(), role: isAdmin ? 'admin' : 'applicant', ...req.body, email: email.toLowerCase(), password: hashed, verified: !MAIL_ENABLED };
    await dbUpsert('users', newUser);
    if (MAIL_ENABLED) {
      const vToken = genToken(); const expires = Date.now() + 86400000;
      await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3)`, [vToken, newUser.id, expires]);
      const verifyUrl = `${APP_URL}/api/verify-email?token=${vToken}`;
      res.status(201).json({ message: 'Account created! Please check your email to verify before logging in.' });
      sendMail(email, 'Verify your Chozen Trade account',
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;"><h2 style="color:#0a6e6e;">Welcome to Chozen Trade & Distribution!</h2><p>Hi <strong>${name}</strong>,</p><p>Please verify your email address:</p><a href="${verifyUrl}" style="display:inline-block;background:#0a6e6e;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Verify Email Address</a><p style="color:#64748b;font-size:.88rem;">This link expires in 24 hours.</p></div>`
      ).catch(e => console.error('Mail error:', e.message));
    } else {
      const token = genToken();
      await createSession(token, newUser.id, newUser.role);
      const out = { ...newUser }; delete out.password;
      res.status(201).json({ user: out, token });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' });
    const token = genToken();
    await createSession(token, 'admin', 'admin');
    return res.json({ user: { id: 'admin', name: 'Administrator', email: ADMIN_EMAIL, role: 'admin' }, token });
  }
  try {
    const users = await dbGetAll('users');
    const user = users.find(u => u.email === email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (MAIL_ENABLED && user.verified === false) return res.status(403).json({ error: 'Please verify your email first.' });
    const token = genToken();
    await createSession(token, user.id, user.role || 'applicant');
    const out = { ...user }; delete out.password;
    res.json({ user: out, token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/logout
app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-auth-token'] || '';
  if (token) await db.query(`DELETE FROM sessions WHERE token=$1`, [token]).catch(() => {});
  res.json({ ok: true });
});

// PUT /api/profile
app.put('/api/profile', async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const users = await dbGetAll('users');
    const idx = users.findIndex(u => u.id === sess.userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    const body = { ...req.body };
    ['id','email','password','role','createdAt'].forEach(k => delete body[k]);
    users[idx] = { ...users[idx], ...body };
    await dbUpsert('users', users[idx]);
    const out = { ...users[idx] }; delete out.password;
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/products
app.get('/api/products', async (req, res) => {
  try { res.json(await dbGetAll('products')); } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
  try {
    const prod = await dbGetOne('products', req.params.id);
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    res.json(prod);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/products
app.post('/api/products', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { title, category, price } = req.body || {};
  if (!title || !category || !price) return res.status(400).json({ error: 'Missing fields' });
  try {
    const newProduct = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'active', tags: [], stock: 'In Stock', urgent: false, ...req.body };
    await dbUpsert('products', newProduct);
    res.status(201).json(newProduct);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/products/:id
app.put('/api/products/:id', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const prod = await dbGetOne('products', req.params.id);
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    const updated = { ...prod, ...req.body, id: req.params.id };
    await dbUpsert('products', updated);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try { await dbDelete('products', req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orders
app.post('/api/orders', async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: 'Login required' });
  try {
    const record = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'Pending', buyerId: sess.userId, ...req.body };
    await dbUpsert('orders', record);
    sendMail(req.body.email, 'Inquiry Received — Chozen Trade & Distribution', `<h2>Hi ${req.body.name},</h2><p>We received your inquiry for <strong>${req.body.product}</strong>. We will contact you within 24 hours.</p>`);
    sendMail(ADMIN_EMAIL, `New Inquiry: ${req.body.product}`, `<p><b>${req.body.name}</b> (${req.body.email}) submitted an inquiry for <b>${req.body.product}</b>, qty: ${req.body.quantity || '—'}.</p>`);
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/my-orders
app.get('/api/my-orders', async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: 'Login required' });
  try {
    const orders = await dbGetAll('orders');
    res.json(orders.filter(o => o.buyerId === sess.userId));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/orders
app.get('/api/admin/orders', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try { res.json(await dbGetAll('orders')); } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/orders/:id
app.put('/api/admin/orders/:id', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const order = await dbGetOne('orders', req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    const updated = { ...order, ...req.body, id: req.params.id };
    await dbUpsert('orders', updated);
    if (req.body.status && updated.email) sendMail(updated.email, `Order Update — Chozen Trade`, `<p>Your inquiry for <b>${updated.product}</b> is now: <b>${req.body.status}</b>.</p>`);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users
app.get('/api/admin/users', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const users = await dbGetAll('users');
    res.json(users.map(u => { const o = { ...u }; delete o.password; return o; }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/users/:id/role
app.put('/api/admin/users/:id/role', async (req, res) => {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { role } = req.body;
  if (!['admin', 'applicant'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const users = await dbGetAll('users');
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx] = { ...users[idx], role };
    await dbUpsert('users', users[idx]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/forgot-password
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  res.json({ ok: true }); // always respond success
  try {
    const users = await dbGetAll('users');
    const user = users.find(u => u.email === email.toLowerCase());
    if (!user) return;
    const resetToken = genToken(); const expires = Date.now() + 3600000;
    await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET expires=$3`, [resetToken, user.id, expires]);
    const resetUrl = `${APP_URL}/reset-password.html?token=${resetToken}`;
    sendMail(email, 'Reset Your Password — Chozen Trade & Distribution',
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;"><h2 style="color:#0a6e6e;">Password Reset Request</h2><p>Hi <strong>${user.name}</strong>,</p><p>Click below to reset your password:</p><a href="${resetUrl}" style="display:inline-block;background:#0a6e6e;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Reset My Password</a><p style="color:#64748b;font-size:.88rem;">This link expires in 1 hour.</p></div>`
    ).catch(e => console.error('Mail error:', e.message));
  } catch(e) { console.error(e); }
});

// POST /api/reset-password
app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await db.query(`SELECT user_id,expires FROM verifications WHERE token=$1`, [token]);
    if (!r.rows.length || parseInt(r.rows[0].expires) < Date.now()) return res.status(400).json({ error: 'Reset link expired or invalid' });
    const userId = r.rows[0].user_id;
    await db.query(`DELETE FROM verifications WHERE token=$1`, [token]);
    const hashed = await bcrypt.hash(password, 10);
    const users = await dbGetAll('users');
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx].password = hashed;
    await dbUpsert('users', users[idx]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/verify-email
app.get('/api/verify-email', async (req, res) => {
  const token = req.query.token || '';
  if (!token) return res.redirect('/login.html?verified=fail');
  try {
    const r = await db.query(`SELECT user_id,expires FROM verifications WHERE token=$1`, [token]);
    if (!r.rows.length || parseInt(r.rows[0].expires) < Date.now()) return res.redirect('/login.html?verified=expired');
    const userId = r.rows[0].user_id;
    const users = await dbGetAll('users');
    const idx = users.findIndex(u => u.id === userId);
    if (idx >= 0) { users[idx].verified = true; await dbUpsert('users', users[idx]); }
    await db.query(`DELETE FROM verifications WHERE token=$1`, [token]);
    res.redirect('/login.html?verified=success');
  } catch(e) { res.redirect('/login.html?verified=fail'); }
});

module.exports = app;
