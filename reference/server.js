require('dotenv').config();

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR   = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

const MAIL_ENABLED = process.env.MAIL_ENABLED === 'true';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAILJET_API_KEY = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET = process.env.MAILJET_SECRET || '';

async function sendMail(to, subject, html) {
  if (!MAIL_ENABLED) return;
  try {
    if (MAILJET_API_KEY && MAILJET_SECRET) {
      const Mailjet = require('node-mailjet');
      const mj = Mailjet.apiConnect(MAILJET_API_KEY, MAILJET_SECRET);
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{
          From: { Email: process.env.MAIL_USER || 'christine.chozenresource@gmail.com', Name: 'Chozen Resources Inc.' },
          To: [{ Email: to }],
          Subject: subject,
          HTMLPart: html
        }]
      });
    } else if (RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({ from: 'Chozen Resources Inc. <onboarding@resend.dev>', to, subject, html });
    }
  } catch(e) { console.error('Mail error:', e.message); }
}
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@chozenresources.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@CRI2026';

// Pre-approved admin emails — auto-get admin role on register, cannot be demoted
const ADMIN_EMAIL_LIST = (process.env.ADMIN_EMAIL_LIST || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

async function isPreApprovedAdmin(email) {
  const e = email.toLowerCase();
  if (ADMIN_EMAIL_LIST.includes(e)) return true;
  if (USE_PG && db) {
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS admin_emails (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`);
      const r = await db.query(`SELECT 1 FROM admin_emails WHERE email=$1`, [e]);
      return r.rows.length > 0;
    } catch(err) { return false; }
  }
  return false;
}

// ── Database: PostgreSQL if DATABASE_URL set, else JSON files ──
let db = null;
const USE_PG = !!process.env.DATABASE_URL;

async function initDB() {
  if (!USE_PG) {
    if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log('Using local JSON files.');
    return;
  }
  const { Pool } = require('pg');
  db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires BIGINT NOT NULL
    );
  `);
  // Clean expired sessions on startup
  await db.query(`DELETE FROM sessions WHERE expires < $1`, [Date.now()]);
  // Clean expired verification tokens
  if (USE_PG) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS verifications (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires BIGINT NOT NULL
      );
    `);
    await db.query(`DELETE FROM verifications WHERE expires < $1`, [Date.now()]);
  }
  console.log('Using PostgreSQL database.');
}

// ── DB Helpers ──
async function dbGetAll(table) {
  if (!USE_PG) {
    const file = path.join(DATA_DIR, table + '.json');
    try { return JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch(e) { return []; }
  }
  const r = await db.query(`SELECT data FROM ${table} ORDER BY created_at ASC`);
  return r.rows.map(r => r.data);
}

async function dbSaveAll(table, items) {
  if (!USE_PG) {
    fs.writeFileSync(path.join(DATA_DIR, table + '.json'), JSON.stringify(items, null, 2));
    return;
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${table}`);
    for (const item of items) {
      await client.query(`INSERT INTO ${table}(id, data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`, [item.id, item]);
    }
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function dbGetOne(table, id) {
  const all = await dbGetAll(table);
  return all.find(x => x.id === id) || null;
}

async function dbUpsert(table, item) {
  if (!USE_PG) {
    const all = await dbGetAll(table);
    const idx = all.findIndex(x => x.id === item.id);
    if (idx >= 0) all[idx] = item; else all.push(item);
    await dbSaveAll(table, all);
    return;
  }
  await db.query(`INSERT INTO ${table}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`, [item.id, item]);
}

async function dbDelete(table, id) {
  if (!USE_PG) {
    const all = await dbGetAll(table);
    await dbSaveAll(table, all.filter(x => x.id !== id));
    return;
  }
  await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
}

// ── Sessions — persistent in PostgreSQL, fallback to memory for local ──
const _memSessions = {};
function genToken() { return crypto.randomBytes(32).toString('hex'); }

async function createSession(token, userId, role) {
  const expires = Date.now() + 604800000; // 7 days
  if (USE_PG) {
    await db.query(
      `INSERT INTO sessions(token,user_id,role,expires) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO UPDATE SET expires=$4`,
      [token, userId, role, expires]
    );
  } else {
    _memSessions[token] = { userId, role, expires };
  }
}

async function getSession(req) {
  const token = req.headers['x-auth-token'] || '';
  if (!token) return null;
  if (USE_PG) {
    try {
      const r = await db.query(`SELECT user_id, role, expires FROM sessions WHERE token=$1`, [token]);
      if (!r.rows.length) return null;
      const s = r.rows[0];
      if (parseInt(s.expires) < Date.now()) {
        await db.query(`DELETE FROM sessions WHERE token=$1`, [token]);
        return null;
      }
      return { userId: s.user_id, role: s.role, expires: parseInt(s.expires) };
    } catch(e) { return null; }
  } else {
    const s = _memSessions[token];
    if (!s || s.expires < Date.now()) { delete _memSessions[token]; return null; }
    return s;
  }
}

async function deleteSession(token) {
  if (USE_PG) {
    await db.query(`DELETE FROM sessions WHERE token=$1`, [token]);
  } else {
    delete _memSessions[token];
  }
}

// ── Utilities ──
function responseJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function responseError(res, status, msg) { responseJSON(res, status, { error: msg }); }

function collectBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c.toString(); if (body.length > 5e6) req.destroy(); });
  req.on('end', () => { try { cb(null, body ? JSON.parse(body) : {}); } catch(e) { cb(e); } });
  req.on('error', cb);
}

function collectRawBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => cb(null, Buffer.concat(chunks)));
  req.on('error', cb);
}

async function sendMailOLD() {} // replaced by Resend above

function parseMultipart(body, boundary) {
  const parts = [], sep = Buffer.from('--' + boundary);
  let start = 0;
  while (true) {
    const idx = body.indexOf(sep, start); if (idx === -1) break;
    const next = body.indexOf(sep, idx + sep.length); if (next === -1) break;
    const chunk = body.slice(idx + sep.length + 2, next - 2);
    const headerEnd = chunk.indexOf(Buffer.from('\r\n\r\n')); if (headerEnd === -1) { start = next; continue; }
    const headerStr = chunk.slice(0, headerEnd).toString();
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) parts.push({ name: nameMatch[1], filename: fileMatch ? fileMatch[1] : null, data: chunk.slice(headerEnd + 4) });
    start = next;
  }
  return parts;
}

const mimeTypes = {
  '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.pdf':'application/pdf',
  '.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon'
};

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  const rawPath = req.url.split('?')[0];
  const reqPath = decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath);
  const method  = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,x-auth-token','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE' });
    res.end(); return;
  }

  if (!reqPath.startsWith('/api/')) {
    const filePath = path.resolve(PUBLIC_DIR, '.' + reqPath);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'text/plain' });
      res.end(content);
    });
    return;
  }

  try { await apiRouter(req, res, reqPath, method); }
  catch(e) { console.error(e); responseError(res, 500, 'Server error'); }
});

async function apiRouter(req, res, p, m) {

  // POST /api/forgot-password
  if (p === '/api/forgot-password' && m === 'POST') {
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { email } = body || {};
      if (!email) return responseError(res, 400, 'Email required');
      try {
        const users = await dbGetAll('users');
        const user = users.find(u => u.email === email.toLowerCase());
        // Always respond success to prevent email enumeration
        responseJSON(res, 200, { ok: true });
        if (!user) return;
        const resetToken = genToken();
        const expires = Date.now() + 3600000; // 1 hour
        if (USE_PG) {
          await db.query(`CREATE TABLE IF NOT EXISTS verifications (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL)`);
          await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET expires=$3`, [resetToken, user.id, expires]);
        }
        const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password.html?token=${resetToken}`;
        sendMail(email, 'Reset Your Password — Chozen Resources Inc.',
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;">
            <h2 style="color:#1a4fd6;">Password Reset Request</h2>
            <p>Hi <strong>${user.name}</strong>,</p>
            <p>We received a request to reset your password. Click the button below to set a new password:</p>
            <a href="${resetUrl}" style="display:inline-block;background:#1a4fd6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Reset My Password</a>
            <p style="color:#64748b;font-size:.88rem;">This link expires in 1 hour. If you did not request a password reset, you can ignore this email.</p>
          </div>`
        ).catch(e => console.error('Mail error:', e.message));
      } catch(e) { console.error(e); }
    }); return;
  }

  // POST /api/reset-password
  if (p === '/api/reset-password' && m === 'POST') {
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { token, password } = body || {};
      if (!token || !password) return responseError(res, 400, 'Missing fields');
      if (password.length < 8) return responseError(res, 400, 'Password must be at least 8 characters');
      try {
        let userId = null;
        if (USE_PG) {
          const r = await db.query(`SELECT user_id, expires FROM verifications WHERE token=$1`, [token]);
          if (!r.rows.length || parseInt(r.rows[0].expires) < Date.now()) return responseError(res, 400, 'Reset link expired or invalid');
          userId = r.rows[0].user_id;
          await db.query(`DELETE FROM verifications WHERE token=$1`, [token]);
        } else {
          return responseError(res, 400, 'Reset not supported in local mode');
        }
        const hashed = await new Promise((resolve, reject) => bcrypt.hash(password, 10, (e, h) => e ? reject(e) : resolve(h)));
        const users = await dbGetAll('users');
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return responseError(res, 404, 'User not found');
        users[idx].password = hashed;
        await dbUpsert('users', users[idx]);
        responseJSON(res, 200, { ok: true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/verify-email
  if (p === '/api/verify-email' && m === 'GET') {
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
    const token = qs.get('token') || '';
    if (!token) { res.writeHead(302, { Location: '/login.html?verified=fail' }); res.end(); return; }
    try {
      if (USE_PG) {
        const r = await db.query(`SELECT user_id, expires FROM verifications WHERE token=$1`, [token]);
        if (!r.rows.length || parseInt(r.rows[0].expires) < Date.now()) {
          res.writeHead(302, { Location: '/login.html?verified=expired' }); res.end(); return;
        }
        const userId = r.rows[0].user_id;
        const users = await dbGetAll('users');
        const idx = users.findIndex(u => u.id === userId);
        if (idx >= 0) { users[idx].verified = true; await dbUpsert('users', users[idx]); }
        await db.query(`DELETE FROM verifications WHERE token=$1`, [token]);
      }
      res.writeHead(302, { Location: '/login.html?verified=success' }); res.end();
    } catch(e) { res.writeHead(302, { Location: '/login.html?verified=fail' }); res.end(); }
    return;
  }

  // POST /api/register
  if (p === '/api/register' && m === 'POST') {
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { name, email, password } = body || {};
      if (!name || !email || !password) return responseError(res, 400, 'Missing required fields');
      try {
        const users = await dbGetAll('users');
        const existing = users.find(u => u.email === email.toLowerCase());
        if (existing) {
          // Allow re-registration if unverified and MAIL_ENABLED
          if (MAIL_ENABLED && existing.verified === false) {
            // Remove old unverified account and allow re-register
            await dbDelete('users', existing.id);
          } else {
            return responseError(res, 409, 'Email already registered');
          }
        }
        const hashed = await new Promise((resolve,reject) => bcrypt.hash(password, 10, (e,h) => e ? reject(e) : resolve(h)));
        const newUser = { id: Date.now().toString(), createdAt: new Date().toISOString(), role: (body.role === 'admin' || await isPreApprovedAdmin(email)) ? 'admin' : 'applicant', ...body, email: email.toLowerCase(), password: hashed, verified: !MAIL_ENABLED };
        await dbUpsert('users', newUser);
        if (MAIL_ENABLED) {
          const vToken = genToken();
          const expires = Date.now() + 86400000;
          if (USE_PG) {
            await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3)`, [vToken, newUser.id, expires]);
          }
          const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/verify-email?token=${vToken}`;
          // Respond immediately, send email in background
          responseJSON(res, 201, { message: 'Account created! Please check your email to verify your account before logging in.' });
          sendMail(email, 'Verify your Chozen Resources Inc. account',
            `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;">
              <h2 style="color:#1a4fd6;">Welcome to Chozen Resources Inc.!</h2>
              <p>Hi <strong>${name}</strong>,</p>
              <p>Please verify your email address by clicking the button below:</p>
              <a href="${verifyUrl}" style="display:inline-block;background:#1a4fd6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Verify Email Address</a>
              <p style="color:#64748b;font-size:.88rem;">This link expires in 24 hours. If you did not register, ignore this email.</p>
            </div>`
          ).catch(e => console.error('Mail error:', e.message));
        } else {
          const token = genToken();
          await createSession(token, newUser.id, newUser.role || 'applicant');
          const out = { ...newUser }; delete out.password;
          responseJSON(res, 201, { user: out, token });
        }
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // POST /api/login
  if (p === '/api/login' && m === 'POST') {
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { email, password } = body || {};
      if (!email || !password) return responseError(res, 400, 'Missing fields');
      if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        if (password !== ADMIN_PASSWORD) return responseError(res, 401, 'Invalid credentials');
        const token = genToken();
        await createSession(token, 'admin', 'admin');
        return responseJSON(res, 200, { user: { id:'admin', name:'Administrator', email:ADMIN_EMAIL, role:'admin' }, token });
      }
      try {
        const users = await dbGetAll('users');
        const user = users.find(u => u.email === email.toLowerCase());
        if (!user) return responseError(res, 401, 'Invalid credentials');
        const ok = await new Promise((resolve,reject) => bcrypt.compare(password, user.password, (e,r) => e ? reject(e) : resolve(r)));
        if (!ok) return responseError(res, 401, 'Invalid credentials');
        if (MAIL_ENABLED && user.verified === false) return responseError(res, 403, 'Please verify your email first. Check your inbox for the verification link.');
        const token = genToken();
        await createSession(token, user.id, user.role || 'applicant');
        const out = { ...user }; delete out.password;
        responseJSON(res, 200, { user: out, token });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // POST /api/logout
  if (p === '/api/logout' && m === 'POST') {
    await deleteSession(req.headers['x-auth-token'] || '');
    responseJSON(res, 200, { ok: true }); return;
  }

  // PUT /api/profile
  if (p === '/api/profile' && m === 'PUT') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Not authenticated');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try {
        const users = await dbGetAll('users');
        const idx = users.findIndex(u => u.id === sess.userId);
        if (idx === -1) return responseError(res, 404, 'User not found');
        ['id','email','password','role','createdAt'].forEach(k => delete body[k]);
        users[idx] = { ...users[idx], ...body };
        await dbUpsert('users', users[idx]);
        const out = { ...users[idx] }; delete out.password;
        responseJSON(res, 200, out);
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/jobs
  if (p === '/api/jobs' && m === 'GET') {
    try { responseJSON(res, 200, await dbGetAll('jobs')); } catch(e) { responseError(res, 500, e.message); } return;
  }

  // GET /api/jobs/:id
  if (p.startsWith('/api/jobs/') && m === 'GET') {
    const jobId = p.split('/api/jobs/')[1];
    try {
      const job = await dbGetOne('jobs', jobId);
      if (!job) return responseError(res, 404, 'Job not found');
      responseJSON(res, 200, job);
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // POST /api/jobs
  if (p === '/api/jobs' && m === 'POST') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      if (!body.title || !body.location || !body.type || !body.salary || !body.description) return responseError(res, 400, 'Missing fields');
      try {
        const newJob = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'active', tags: [], ...body };
        await dbUpsert('jobs', newJob);
        responseJSON(res, 201, newJob);
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // PUT /api/jobs/:id
  if (p.startsWith('/api/jobs/') && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const jobId = p.split('/api/jobs/')[1];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try {
        const job = await dbGetOne('jobs', jobId);
        if (!job) return responseError(res, 404, 'Job not found');
        const updated = { ...job, ...body, id: jobId };
        await dbUpsert('jobs', updated);
        responseJSON(res, 200, updated);
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // DELETE /api/jobs/:id
  if (p.startsWith('/api/jobs/') && m === 'DELETE') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { await dbDelete('jobs', p.split('/api/jobs/')[1]); responseJSON(res, 200, { ok:true }); }
    catch(e) { responseError(res, 500, e.message); } return;
  }

  // DELETE /api/withdraw/:id
  if (p.startsWith('/api/withdraw/') && m === 'DELETE') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    const appId = p.split('/api/withdraw/')[1];
    try {
      const app = await dbGetOne('applications', appId);
      if (!app) return responseError(res, 404, 'Application not found');
      if (app.applicantId !== sess.userId) return responseError(res, 403, 'Not your application');
      if (app.status !== 'Pending') return responseError(res, 400, 'Only pending applications can be withdrawn');
      await dbDelete('applications', appId);
      responseJSON(res, 200, { ok: true });
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // POST /api/apply
  if (p === '/api/apply' && m === 'POST') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try {
        const apps = await dbGetAll('applications');
        if (apps.find(a => a.applicantId === sess.userId && a.jobId === body.jobId)) return responseError(res, 409, 'Already applied');
        const record = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'Pending', applicantId: sess.userId, ...body };
        await dbUpsert('applications', record);
        sendMail(body.email, 'Application Received — Chozen Resources Inc.', `<h2>Hi ${body.name},</h2><p>We received your application for <strong>${body.job}</strong>. We will contact you within 24 hours.</p>`);
        sendMail(ADMIN_EMAIL, `New Application: ${body.job}`, `<p><b>${body.name}</b> (${body.email}) applied for <b>${body.job}</b></p>`);
        responseJSON(res, 201, { ok:true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // POST /api/apply/upload
  if (p === '/api/apply/upload' && m === 'POST') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return responseError(res, 400, 'Multipart required');
    const boundary = ct.split('boundary=')[1]; if (!boundary) return responseError(res, 400, 'No boundary');
    collectRawBody(req, (err, raw) => {
      if (err) return responseError(res, 400, 'Upload error');
      const parts = parseMultipart(raw, boundary);
      const filePart = parts.find(p => p.filename); if (!filePart) return responseError(res, 400, 'No file');
      const ext = path.extname(filePart.filename).toLowerCase();
      if (!['.pdf','.doc','.docx'].includes(ext)) return responseError(res, 400, 'Only PDF/DOC/DOCX allowed');
      const fname = sess.userId + '_' + Date.now() + ext;
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFile(path.join(UPLOAD_DIR, fname), filePart.data, err => {
        if (err) return responseError(res, 500, 'File save error');
        responseJSON(res, 200, { filename: fname });
      });
    }); return;
  }

  // GET /api/my-applications
  if (p === '/api/my-applications' && m === 'GET') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    try {
      const apps = await dbGetAll('applications');
      responseJSON(res, 200, apps.filter(a => a.applicantId === sess.userId));
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // GET /api/admin/applications
  if (p === '/api/admin/applications' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { responseJSON(res, 200, await dbGetAll('applications')); } catch(e) { responseError(res, 500, e.message); } return;
  }

  // PUT /api/admin/applications/:id
  if (p.startsWith('/api/admin/applications/') && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const appId = p.split('/api/admin/applications/')[1];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try {
        const app = await dbGetOne('applications', appId);
        if (!app) return responseError(res, 404, 'Not found');
        const updated = { ...app, ...body, id: appId };
        await dbUpsert('applications', updated);
        if (body.status && updated.email) sendMail(updated.email, `Application Update — ${updated.job}`, `<p>Your application for <b>${updated.job}</b> is now: <b>${body.status}</b>.</p>`);
        responseJSON(res, 200, updated);
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/admin/users
  if (p === '/api/admin/users' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try {
      const users = await dbGetAll('users');
      responseJSON(res, 200, users.map(u => { const o = {...u}; delete o.password; return o; }));
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // PUT /api/admin/users/:id/role
  if (p.match(/^\/api\/admin\/users\/[^/]+\/role$/) && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const userId = p.split('/')[4];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { role } = body;
      if (!['admin','applicant'].includes(role)) return responseError(res, 400, 'Invalid role');
      try {
        const users = await dbGetAll('users');
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return responseError(res, 404, 'User not found');
        // Prevent demotion of pre-approved admins
        if (role === 'applicant' && await isPreApprovedAdmin(users[idx].email)) {
          return responseError(res, 403, 'This admin account cannot be demoted.');
        }
        users[idx] = { ...users[idx], role };
        await dbUpsert('users', users[idx]);
        responseJSON(res, 200, { ok: true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/admin/approved-emails
  if (p === '/api/admin/approved-emails' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try {
      if (USE_PG) {
        await db.query(`CREATE TABLE IF NOT EXISTS admin_emails (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`);
        const r = await db.query(`SELECT email FROM admin_emails ORDER BY created_at ASC`);
        responseJSON(res, 200, r.rows.map(x => x.email));
      } else {
        const list = (process.env.ADMIN_EMAIL_LIST || '').split(',').map(e => e.trim()).filter(Boolean);
        responseJSON(res, 200, list);
      }
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // POST /api/admin/approved-emails
  if (p === '/api/admin/approved-emails' && m === 'POST') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const email = (body.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responseError(res, 400, 'Invalid email');
      try {
        if (USE_PG) {
          await db.query(`CREATE TABLE IF NOT EXISTS admin_emails (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`);
          await db.query(`INSERT INTO admin_emails(email) VALUES($1) ON CONFLICT DO NOTHING`, [email]);
        }
        responseJSON(res, 201, { ok: true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // DELETE /api/admin/approved-emails/:email
  if (p.startsWith('/api/admin/approved-emails/') && m === 'DELETE') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const email = decodeURIComponent(p.split('/api/admin/approved-emails/')[1]);
    try {
      if (USE_PG) {
        await db.query(`DELETE FROM admin_emails WHERE email=$1`, [email]);
      }
      responseJSON(res, 200, { ok: true });
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // DELETE /api/admin/users/:id
  if (p.startsWith('/api/admin/users/') && !p.includes('/role') && m === 'DELETE') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const userId = p.split('/api/admin/users/')[1];
    try {
      const users = await dbGetAll('users');
      const user = users.find(u => u.id === userId);
      if (user && isPreApprovedAdmin(user.email)) {
        return responseError(res, 403, 'This admin account cannot be deleted.');
      }
      await dbDelete('users', userId);
      responseJSON(res, 200, { ok:true });
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // DELETE /api/admin/clear-applications
  if (p === '/api/admin/clear-applications' && m === 'DELETE') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { await dbSaveAll('applications', []); responseJSON(res, 200, { ok:true }); }
    catch(e) { responseError(res, 500, e.message); } return;
  }

  // GET /api/admin/analytics
  if (p === '/api/admin/analytics' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try {
      const [apps, users, jobs] = await Promise.all([dbGetAll('applications'), dbGetAll('users'), dbGetAll('jobs')]);
      const now = new Date();
      const thisMonth = apps.filter(a => { const d = new Date(a.createdAt); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); });
      const byJob = {}; apps.forEach(a => { byJob[a.job]=(byJob[a.job]||0)+1; });
      const topJob = Object.entries(byJob).sort((a,b)=>b[1]-a[1])[0];
      const byStatus = { Pending:0,'For Interview':0,Hired:0,Rejected:0 };
      apps.forEach(a => { if(byStatus[a.status]!==undefined) byStatus[a.status]++; });
      responseJSON(res, 200, { totalApplicants:users.length, totalApplications:apps.length, thisMonth:thisMonth.length, activeJobs:jobs.filter(j=>j.status!=='closed').length, topJob:topJob?topJob[0]:'—', byStatus });
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  // GET /api/admin/export/csv
  if (p === '/api/admin/export/csv' && m === 'GET') {
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
    const token = req.headers['x-auth-token'] || qs.get('token') || '';
    const sess = await getSession({ headers: { 'x-auth-token': token } });
    if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try {
      const apps = await dbGetAll('applications');
      const headers = ['id','name','email','phone','job','status','experience','address','city','province','education','skills','availability','createdAt'];
      const rows = apps.map(a => headers.map(h => '"'+String(a[h]||'').replace(/"/g,'""')+'"').join(','));
      const csv = [headers.join(','), ...rows].join('\r\n');
      res.writeHead(200, { 'Content-Type':'text/csv','Content-Disposition':'attachment; filename="applications.csv"' });
      res.end(csv);
    } catch(e) { responseError(res, 500, e.message); } return;
  }

  responseError(res, 404, 'API endpoint not found');
}

// ── Start ──
initDB().then(() => {
  server.listen(PORT, () => console.log(`Chozen Resources Inc. running at http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
