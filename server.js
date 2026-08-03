require('dotenv').config();

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR   = path.join(__dirname, 'data');

const MAIL_ENABLED   = process.env.MAIL_ENABLED === 'true';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAILJET_API_KEY = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET  = process.env.MAILJET_SECRET  || '';

async function sendMail(to, subject, html) {
  if (!MAIL_ENABLED) return;
  try {
    if (MAILJET_API_KEY && MAILJET_SECRET) {
      const Mailjet = require('node-mailjet');
      const mj = Mailjet.apiConnect(MAILJET_API_KEY, MAILJET_SECRET);
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{ From: { Email: process.env.MAIL_USER || 'info@chozentrade.com', Name: 'Chozen Trade' }, To: [{ Email: to }], Subject: subject, HTMLPart: html }]
      });
    } else if (RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({ from: 'Chozen Trade <onboarding@resend.dev>', to, subject, html });
    }
  } catch(e) { console.error('Mail error:', e.message); }
}

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@chozentrade.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@CT2026';
const ADMIN_EMAIL_LIST = (process.env.ADMIN_EMAIL_LIST || '').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean);

// ── Database ──
let db = null;
const USE_PG = !!process.env.DATABASE_URL;

async function initDB() {
  if (!USE_PG) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Using local JSON files.');
    return;
  }
  const { Pool } = require('pg');
  db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.query(`
    CREATE TABLE IF NOT EXISTS users       (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS orders      (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS products    (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS sessions    (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS verifications (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL);
  `);
  await db.query(`DELETE FROM sessions WHERE expires < $1`, [Date.now()]);
  await db.query(`DELETE FROM verifications WHERE expires < $1`, [Date.now()]);
  console.log('Using PostgreSQL database.');
}

async function dbGetAll(table) {
  if (!USE_PG) { const f=path.join(DATA_DIR,table+'.json'); try{return JSON.parse(fs.readFileSync(f,'utf8')||'[]');}catch(e){return[];} }
  const r = await db.query(`SELECT data FROM ${table} ORDER BY created_at ASC`);
  return r.rows.map(r=>r.data);
}

async function dbSaveAll(table, items) {
  if (!USE_PG) { fs.writeFileSync(path.join(DATA_DIR,table+'.json'),JSON.stringify(items,null,2)); return; }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${table}`);
    for (const item of items) await client.query(`INSERT INTO ${table}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`,[item.id,item]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function dbGetOne(table, id) { const all=await dbGetAll(table); return all.find(x=>x.id===id)||null; }

async function dbUpsert(table, item) {
  if (!USE_PG) { const all=await dbGetAll(table); const idx=all.findIndex(x=>x.id===item.id); if(idx>=0)all[idx]=item;else all.push(item); await dbSaveAll(table,all); return; }
  await db.query(`INSERT INTO ${table}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2`,[item.id,item]);
}

async function dbDelete(table, id) {
  if (!USE_PG) { const all=await dbGetAll(table); await dbSaveAll(table,all.filter(x=>x.id!==id)); return; }
  await db.query(`DELETE FROM ${table} WHERE id=$1`,[id]);
}

// ── Sessions ──
const _memSessions = {};
const _localResetTokens = {}; // local-mode password reset tokens
function genToken() { return crypto.randomBytes(32).toString('hex'); }

async function createSession(token, userId, role) {
  const expires = Date.now() + 604800000;
  if (USE_PG) await db.query(`INSERT INTO sessions(token,user_id,role,expires) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO UPDATE SET expires=$4`,[token,userId,role,expires]);
  else _memSessions[token] = { userId, role, expires };
}

async function getSession(req) {
  const token = req.headers['x-auth-token'] || ''; if (!token) return null;
  if (USE_PG) {
    try { const r=await db.query(`SELECT user_id,role,expires FROM sessions WHERE token=$1`,[token]); if(!r.rows.length)return null; const s=r.rows[0]; if(parseInt(s.expires)<Date.now()){await db.query(`DELETE FROM sessions WHERE token=$1`,[token]);return null;} return{userId:s.user_id,role:s.role,expires:parseInt(s.expires)}; } catch(e){return null;}
  } else { const s=_memSessions[token]; if(!s||s.expires<Date.now()){delete _memSessions[token];return null;} return s; }
}

async function deleteSession(token) {
  if (USE_PG) await db.query(`DELETE FROM sessions WHERE token=$1`,[token]);
  else delete _memSessions[token];
}

function responseJSON(res, status, data) { res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function responseError(res, status, msg)  { responseJSON(res,status,{error:msg}); }

function collectBody(req, cb) {
  let body='';
  req.on('data',c=>{body+=c.toString();if(body.length>5e6)req.destroy();});
  req.on('end',()=>{try{cb(null,body?JSON.parse(body):{});}catch(e){cb(e);}});
  req.on('error',cb);
}

const mimeTypes = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.pdf':'application/pdf','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon'};

const server = http.createServer(async (req, res) => {
  const rawPath = req.url.split('?')[0];
  const reqPath = decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath);
  const method  = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,x-auth-token','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE'});
    res.end(); return;
  }

  if (!reqPath.startsWith('/api/')) {
    const filePath = path.resolve(PUBLIC_DIR, '.' + reqPath);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found'); return; }
      res.writeHead(200,{'Content-Type':mimeTypes[path.extname(filePath)]||'text/plain'});
      res.end(content);
    }); return;
  }

  try { await apiRouter(req, res, reqPath, method); }
  catch(e) { console.error(e); responseError(res, 500, 'Server error'); }
});

async function apiRouter(req, res, p, m) {

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
          if (MAIL_ENABLED && existing.verified === false) await dbDelete('users', existing.id);
          else return responseError(res, 409, 'Email already registered');
        }
        const hashed = await new Promise((resolve,reject) => bcrypt.hash(password,10,(e,h)=>e?reject(e):resolve(h)));
        const isAdmin = ADMIN_EMAIL_LIST.includes(email.toLowerCase());
        const newUser = { id: Date.now().toString(), createdAt: new Date().toISOString(), role: isAdmin ? 'admin' : 'applicant', ...body, email: email.toLowerCase(), password: hashed, verified: !MAIL_ENABLED };
        await dbUpsert('users', newUser);
        if (MAIL_ENABLED) {
          const vToken = genToken(); const expires = Date.now() + 86400000;
          if (USE_PG) await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3)`,[vToken,newUser.id,expires]);
          const verifyUrl = `${process.env.APP_URL||'http://localhost:3000'}/api/verify-email?token=${vToken}`;
          responseJSON(res, 201, { message: 'Account created! Please check your email to verify before logging in.' });
          sendMail(email, 'Verify your Chozen Trade account',
            `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;"><h2 style="color:#1a4fd6;">Welcome to Chozen Trade!</h2><p>Hi <strong>${name}</strong>,</p><p>Please verify your email address:</p><a href="${verifyUrl}" style="display:inline-block;background:#1a4fd6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Verify Email Address</a><p style="color:#64748b;font-size:.88rem;">This link expires in 24 hours.</p></div>`
          ).catch(e=>console.error('Mail error:',e.message));
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
        const token = genToken(); await createSession(token, 'admin', 'admin');
        return responseJSON(res, 200, { user: { id:'admin', name:'Administrator', email:ADMIN_EMAIL, role:'admin' }, token });
      }
      try {
        const users = await dbGetAll('users');
        const user = users.find(u => u.email === email.toLowerCase());
        if (!user) return responseError(res, 401, 'Invalid credentials');
        const ok = await new Promise((resolve,reject) => bcrypt.compare(password, user.password, (e,r)=>e?reject(e):resolve(r)));
        if (!ok) return responseError(res, 401, 'Invalid credentials');
        if (MAIL_ENABLED && user.verified === false) return responseError(res, 403, 'Please verify your email first.');
        const token = genToken(); await createSession(token, user.id, user.role || 'applicant');
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

  // GET /api/products
  if (p === '/api/products' && m === 'GET') {
    try { responseJSON(res, 200, await dbGetAll('products')); } catch(e) { responseError(res, 500, e.message); } return;
  }

  // GET /api/products/:id
  if (p.startsWith('/api/products/') && m === 'GET') {
    try { const prod=await dbGetOne('products',p.split('/api/products/')[1]); if(!prod)return responseError(res,404,'Product not found'); responseJSON(res,200,prod); } catch(e){responseError(res,500,e.message);} return;
  }

  // POST /api/products
  if (p === '/api/products' && m === 'POST') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      if (!body.title || !body.category || !body.price) return responseError(res, 400, 'Missing fields');
      try {
        const newProduct = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'active', tags: [], stock: 'In Stock', urgent: false, ...body };
        await dbUpsert('products', newProduct);
        responseJSON(res, 201, newProduct);
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // PUT /api/products/:id
  if (p.startsWith('/api/products/') && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const pid = p.split('/api/products/')[1];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try { const prod=await dbGetOne('products',pid); if(!prod)return responseError(res,404,'Product not found'); const updated={...prod,...body,id:pid}; await dbUpsert('products',updated); responseJSON(res,200,updated); } catch(e){responseError(res,500,e.message);}
    }); return;
  }

  // DELETE /api/products/:id
  if (p.startsWith('/api/products/') && m === 'DELETE') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { await dbDelete('products',p.split('/api/products/')[1]); responseJSON(res,200,{ok:true}); } catch(e){responseError(res,500,e.message);} return;
  }

  // POST /api/orders
  if (p === '/api/orders' && m === 'POST') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try {
        const record = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'Pending', buyerId: sess.userId, ...body };
        await dbUpsert('orders', record);
        sendMail(body.email, 'Inquiry Received — Chozen Trade', `<h2>Hi ${body.name},</h2><p>We received your inquiry for <strong>${body.product}</strong>. We will contact you within 24 hours.</p>`);
        sendMail(ADMIN_EMAIL, `New Inquiry: ${body.product}`, `<p><b>${body.name}</b> (${body.email}) submitted an inquiry for <b>${body.product}</b>, qty: ${body.quantity||'—'}.</p>`);
        responseJSON(res, 201, { ok: true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/my-orders
  if (p === '/api/my-orders' && m === 'GET') {
    const sess = await getSession(req); if (!sess) return responseError(res, 401, 'Login required');
    try { const orders=await dbGetAll('orders'); responseJSON(res,200,orders.filter(o=>o.buyerId===sess.userId)); } catch(e){responseError(res,500,e.message);} return;
  }

  // GET /api/admin/orders
  if (p === '/api/admin/orders' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { responseJSON(res, 200, await dbGetAll('orders')); } catch(e){responseError(res,500,e.message);} return;
  }

  // PUT /api/admin/orders/:id
  if (p.startsWith('/api/admin/orders/') && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const oid = p.split('/api/admin/orders/')[1];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      try { const order=await dbGetOne('orders',oid); if(!order)return responseError(res,404,'Not found'); const updated={...order,...body,id:oid}; await dbUpsert('orders',updated); if(body.status&&updated.email) sendMail(updated.email,`Order Update — Chozen Trade`,`<p>Your inquiry for <b>${updated.product}</b> is now: <b>${body.status}</b>.</p>`); responseJSON(res,200,updated); } catch(e){responseError(res,500,e.message);}
    }); return;
  }

  // GET /api/admin/users
  if (p === '/api/admin/users' && m === 'GET') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    try { const users=await dbGetAll('users'); responseJSON(res,200,users.map(u=>{const o={...u};delete o.password;return o;})); } catch(e){responseError(res,500,e.message);} return;
  }

  // PUT /api/admin/users/:id/role
  if (p.match(/^\/api\/admin\/users\/[^/]+\/role$/) && m === 'PUT') {
    const sess = await getSession(req); if (!sess || sess.role !== 'admin') return responseError(res, 403, 'Admin only');
    const userId = p.split('/')[4];
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { role } = body;
      if (!['admin','applicant'].includes(role)) return responseError(res, 400, 'Invalid role');
      try { const users=await dbGetAll('users'); const idx=users.findIndex(u=>u.id===userId); if(idx===-1)return responseError(res,404,'User not found'); users[idx]={...users[idx],role}; await dbUpsert('users',users[idx]); responseJSON(res,200,{ok:true}); } catch(e){responseError(res,500,e.message);}
    }); return;
  }

  // POST /api/forgot-password
  if (p === '/api/forgot-password' && m === 'POST') {
    collectBody(req, async (err, body) => {
      if (err) return responseError(res, 400, 'Invalid body');
      const { email } = body || {};
      if (!email) return responseError(res, 400, 'Email required');
      try {
        const users = await dbGetAll('users');
        const user = users.find(u => u.email === email.toLowerCase());
        responseJSON(res, 200, { ok: true });
        if (!user) return;
        const resetToken = genToken(); const expires = Date.now() + 3600000;
        if (USE_PG) await db.query(`INSERT INTO verifications(token,user_id,expires) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET expires=$3`,[resetToken,user.id,expires]);
        else _localResetTokens[resetToken] = { userId: user.id, expires };
        const resetUrl = `${process.env.APP_URL||'http://localhost:3000'}/reset-password.html?token=${resetToken}`;
        sendMail(email, 'Reset Your Password — Chozen Trade',
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;"><h2 style="color:#1a4fd6;">Password Reset Request</h2><p>Hi <strong>${user.name}</strong>,</p><p>Click below to reset your password:</p><a href="${resetUrl}" style="display:inline-block;background:#1a4fd6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Reset My Password</a><p style="color:#64748b;font-size:.88rem;">This link expires in 1 hour.</p></div>`
        ).catch(e=>console.error('Mail error:',e.message));
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
        if (USE_PG) { const r=await db.query(`SELECT user_id,expires FROM verifications WHERE token=$1`,[token]); if(!r.rows.length||parseInt(r.rows[0].expires)<Date.now())return responseError(res,400,'Reset link expired or invalid'); userId=r.rows[0].user_id; await db.query(`DELETE FROM verifications WHERE token=$1`,[token]); }
        else {
          // Local JSON mode: token stored in memory map
          const entry = _localResetTokens[token];
          if (!entry || entry.expires < Date.now()) return responseError(res, 400, 'Reset link expired or invalid');
          userId = entry.userId;
          delete _localResetTokens[token];
        }
        const hashed = await new Promise((resolve,reject)=>bcrypt.hash(password,10,(e,h)=>e?reject(e):resolve(h)));
        const users = await dbGetAll('users'); const idx=users.findIndex(u=>u.id===userId); if(idx===-1)return responseError(res,404,'User not found');
        users[idx].password = hashed; await dbUpsert('users',users[idx]);
        responseJSON(res, 200, { ok: true });
      } catch(e) { responseError(res, 500, e.message); }
    }); return;
  }

  // GET /api/verify-email
  if (p === '/api/verify-email' && m === 'GET') {
    const qs = new URLSearchParams(req.url.includes('?')?req.url.split('?')[1]:'');
    const token = qs.get('token') || '';
    if (!token) { res.writeHead(302,{Location:'/login.html?verified=fail'}); res.end(); return; }
    try {
      if (USE_PG) {
        const r=await db.query(`SELECT user_id,expires FROM verifications WHERE token=$1`,[token]);
        if(!r.rows.length||parseInt(r.rows[0].expires)<Date.now()){res.writeHead(302,{Location:'/login.html?verified=expired'});res.end();return;}
        const userId=r.rows[0].user_id; const users=await dbGetAll('users'); const idx=users.findIndex(u=>u.id===userId);
        if(idx>=0){users[idx].verified=true;await dbUpsert('users',users[idx]);}
        await db.query(`DELETE FROM verifications WHERE token=$1`,[token]);
      }
      res.writeHead(302,{Location:'/login.html?verified=success'}); res.end();
    } catch(e){res.writeHead(302,{Location:'/login.html?verified=fail'});res.end();}
    return;
  }

  responseError(res, 404, 'Not found');
}

initDB().then(() => {
  server.listen(PORT, () => console.log(`✅ Chozen Trade server running at http://localhost:${PORT}`));
}).catch(err => { console.error('DB init error:', err); process.exit(1); });
