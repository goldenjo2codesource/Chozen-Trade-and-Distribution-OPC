// ── Chozen Trade — Frontend App ──

let products = window.fallbackProducts || [];

// ── Auth helpers ──
function getToken()    { return localStorage.getItem('authToken') || ''; }
function setToken(t)   { localStorage.setItem('authToken', t); }
function clearToken()  { localStorage.removeItem('authToken'); }
function getUser()     { try { return JSON.parse(localStorage.getItem('currentUser')); } catch(e) { return null; } }
function saveUser(u)   { localStorage.setItem('currentUser', JSON.stringify(u)); }
function clearUser()   { localStorage.removeItem('currentUser'); }
function authHeaders() { return { 'Content-Type': 'application/json', 'x-auth-token': getToken() }; }

function fetchAuth(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { 'x-auth-token': getToken() });
  if (!opts.headers['Content-Type'] && !(opts.body instanceof FormData)) opts.headers['Content-Type'] = 'application/json';
  return fetch(url, opts).then(r => {
    if (r.status === 401) { clearToken(); clearUser(); window.location.href = 'login.html'; return Promise.reject(new Error('Session expired.')); }
    return r;
  });
}

function logout() {
  fetch('/api/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  clearToken(); clearUser();
  localStorage.removeItem('selectedProduct');
  window.location.href = 'index.html';
}

function showMessage(id, text, status) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.className = 'message ' + status; }
}

function updateAuthNav() {
  const user = getUser();
  document.querySelectorAll('[data-auth-link]').forEach(el => {
    if (user) { el.textContent = 'Logout (' + user.name.split(' ')[0] + ')'; el.href = '#'; el.onclick = e => { e.preventDefault(); logout(); }; }
    else { el.textContent = 'Login'; el.href = 'login.html'; el.onclick = null; }
  });
  document.querySelectorAll('[data-dash-link]').forEach(el => {
    if (user) { el.style.display = ''; el.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html'; }
    else { el.style.display = 'none'; }
  });
}

function setupMenu() {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (!btn || !nav) return;
  btn.onclick = () => {
    const isOpen = nav.classList.toggle('open');
    btn.textContent = isOpen ? '✕' : '☰';
    btn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  };
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); btn.textContent = '☰'; }));
  document.addEventListener('click', (e) => { if (nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) { nav.classList.remove('open'); btn.textContent = '☰'; } });
}

function headerSearch(e) {
  e.preventDefault();
  const q = document.getElementById('headerSearchInput').value.trim();
  if (q) window.location.href = 'products.html?search=' + encodeURIComponent(q);
}

function copyPhone(num, el) {
  navigator.clipboard.writeText(num).then(() => { const orig = el.textContent; el.textContent = 'Copied!'; setTimeout(() => el.textContent = orig, 1400); }).catch(() => {});
}

// ── Products ──
function displayProducts() {
  const list   = document.getElementById('productList');
  const search = document.getElementById('productSearch');
  const cat    = document.getElementById('productCategory');
  const count  = document.getElementById('productCount');
  if (!list) return;

  const q = (search ? search.value : '').toLowerCase();
  const c = cat ? cat.value : 'all';
  const filtered = products.filter(p =>
    (p.status !== 'inactive') &&
    (p.title + ' ' + (p.category || '')).toLowerCase().includes(q) &&
    (c === 'all' || p.category === c)
  );

  if (count) count.textContent = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '') + ' found';

  if (!filtered.length) {
    list.innerHTML = `<div class="products-empty"><div class="products-empty-icon">🔍</div><h3>No products found</h3><p>Try a different search term or category.</p></div>`;
    return;
  }
  let html = '';
  filtered.forEach(p => {
    const catClass = p.category === 'Wholesale' ? 'pill wholesale' : p.category === 'Retail' ? 'pill retail' : 'pill';
    const badge = p.urgent ? '<span class="pill" style="background:#fff0f0;color:#c0392b;margin-left:6px;">🔥 Hot Item</span>' : '';
    const imgHtml = p.image
      ? `<div class="product-card-img"><img src="${p.image}" alt="${p.title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'product-card-img-placeholder\\'><span>📦</span>No Image</div>'"></div>`
      : `<div class="product-card-img"><div class="product-card-img-placeholder"><span>📦</span>No Image</div></div>`;
    html += `<article class="product-card">
      ${imgHtml}
      <div class="product-card-top"><span class="${catClass}">${p.category || 'General'}</span>${badge}<span class="stock-tag">${p.stock === 'In Stock' ? '✅' : '⚠️'} ${p.stock || 'Check Availability'}</span></div>
      <h2>${p.title}</h2>
      <p>${p.description}</p>
      <strong>${p.price}</strong>
      <div class="tag-list">${(p.tags||[]).map(t => '<span>' + t + '</span>').join('')}</div>
      <div style="display:flex;gap:8px;margin-top:auto;">
        <button class="btn primary sm" style="flex:1;" onclick="inquireProduct('${p.id}')">Inquire / Order</button>
      </div>
    </article>`;
  });
  list.innerHTML = html;
}

function fetchProducts() {
  return fetch('/api/products').then(r => r.ok ? r.json() : Promise.reject()).then(d => { products = d; })
    .catch(() => { products = window.fallbackProducts || []; });
}

function setupProductsPage() {
  if (!document.getElementById('productList')) return;
  const search = document.getElementById('productSearch');
  const cat    = document.getElementById('productCategory');

  // Check URL param for search
  const params = new URLSearchParams(window.location.search);
  const urlSearch = params.get('search');
  if (urlSearch && search) search.value = urlSearch;

  fetchProducts().then(() => {
    if (search) search.oninput = displayProducts;
    if (cat)    cat.onchange   = displayProducts;
    displayProducts();
  });
}

function ensureProductsLoaded() { return products.length ? Promise.resolve() : fetchProducts(); }

function inquireProduct(productId) {
  localStorage.setItem('selectedProduct', productId);
  if (getUser()) { window.location.href = 'order.html'; } else { openAuthBox(); }
}

// ── Auth modal ──
function openAuthBox()  { const m = document.getElementById('authModal'); if (m) m.classList.add('show'); }
function closeAuthBox() { const m = document.getElementById('authModal'); if (m) m.classList.remove('show'); }
function showAuthForm(type) {
  const lf = document.getElementById('loginForm'), rf = document.getElementById('registerForm');
  const btns = document.querySelectorAll('.tab-btn');
  if (!lf || !rf) return;
  lf.classList.toggle('hidden', type !== 'login');
  rf.classList.toggle('hidden', type !== 'register');
  btns.forEach(b => b.classList.remove('active'));
  btns[type === 'login' ? 0 : 1].classList.add('active');
}

function getRedirectAfterAuth() { return localStorage.getItem('selectedProduct') ? 'order.html' : 'dashboard.html'; }

// ── Password strength ──
function checkPwStrength(val) {
  const bar = document.getElementById('pwBar'), hint = document.getElementById('pwHint');
  if (!bar) return;
  let s = 0;
  if (val.length >= 8) s++; if (/[A-Z]/.test(val)) s++; if (/[0-9]/.test(val)) s++; if (/[^A-Za-z0-9]/.test(val)) s++;
  const L = [['20%','#c0392b','Too short'],['40%','#e67e22','Weak'],['65%','#f1c40f','Fair'],['85%','#27ae60','Good'],['100%','#1a7a3c','Strong ✓']];
  const l = L[Math.min(s,4)];
  bar.style.width = val.length ? l[0] : '0'; bar.style.background = l[1];
  if (hint) hint.textContent = val.length ? l[2] : 'Min 8 characters with letters and numbers.';
}

// ── Multi-step register ──
let currentStep = 0;
function validateStep(idx) {
  const el = document.getElementById('step-' + idx); if (!el) return true;
  let ok = true;
  el.querySelectorAll('input[required],select[required]').forEach(i => {
    i.style.borderColor = '';
    if (!i.value.trim()) { i.style.borderColor = 'var(--red)'; if (ok) i.focus(); ok = false; }
  });
  if (!ok) { showMessage('registerMessage', 'Punan ang lahat ng required fields.', 'error'); return false; }
  if (idx === 1) {
    const ph = el.querySelector('[name="phone"]');
    if (ph && !/^(09|\+639)\d{9}$/.test(ph.value.replace(/\s/g,''))) { ph.style.borderColor='var(--red)'; showMessage('registerMessage','Invalid mobile: 09XXXXXXXXX','error'); return false; }
  }
  if (idx === 3) {
    const pw = document.querySelector('[name="password"]'), pw2 = document.querySelector('[name="password2"]'), em = document.querySelector('[name="email"]');
    if (pw && pw.value.length < 8) { pw.style.borderColor='var(--red)'; showMessage('registerMessage','Password min 8 characters.','error'); return false; }
    if (pw && pw2 && pw.value !== pw2.value) { pw2.style.borderColor='var(--red)'; showMessage('registerMessage','Passwords do not match.','error'); return false; }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value)) { em.style.borderColor='var(--red)'; showMessage('registerMessage','Invalid email.','error'); return false; }
  }
  showMessage('registerMessage','',''); return true;
}
function goToStep(idx) {
  for (let i=0;i<5;i++) {
    const s=document.getElementById('step-'+i), p=document.querySelector('[data-step="'+i+'"]');
    if (s) s.classList.toggle('active',i===idx);
    if (p) { p.classList.remove('active','done'); if(i===idx) p.classList.add('active'); else if(i<idx) p.classList.add('done'); }
  }
  currentStep = idx;
  if (idx===4) buildConfirm();
  window.scrollTo({top:0,behavior:'smooth'});
}
function nextStep(f) { if (validateStep(f)) goToStep(f+1); }
function prevStep(f) { goToStep(f-1); }
function buildConfirm() {
  const form = document.getElementById('registerForm'); if (!form) return;
  const g = n => (form.querySelector('[name="'+n+'"]')||{}).value||'—';
  const rows = [['First Name',g('firstname')],['Last Name',g('lastname')],['Middle Name',g('middlename')||'—'],['Birthdate',g('birthdate')],['Gender',g('gender')],['Civil Status',g('civilStatus')],['Nationality',g('nationality')],['Mobile',g('phone')],['Address',g('address')+', '+g('city')+', '+g('province')],['Buyer Type',g('buyerType')],['Business Name',g('businessName')||'—'],['Industry',g('industry')],['Monthly Volume',g('orderVolume')],['Gov ID',g('govId')+' – '+g('govIdNumber')],['Email',g('email')],['Password','••••••••']];
  const dl = document.getElementById('confirmDetails'); if (!dl) return;
  dl.innerHTML = rows.map(r=>'<dt>'+r[0]+'</dt><dd>'+r[1]+'</dd>').join('');
}

function setupRegisterForm() {
  const form = document.getElementById('registerForm'); if (!form) return;
  const isModal = form.closest('#authModal') || !document.getElementById('step-0');
  form.onsubmit = function(e) {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (isModal) {
      const name=form.name.value.trim(), email=form.email.value.trim().toLowerCase(), password=form.password.value;
      if (!name||!email||!password){showMessage('registerMessage','Punan ang lahat.','error');return;}
      btn.disabled=true; btn.textContent='Please wait…';
      fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})})
        .then(r=>r.status===201?r.json():r.json().then(j=>{throw new Error(j.error||'Failed');}))
        .then(d=>{saveUser(d.user);setToken(d.token);showMessage('registerMessage','Account created! Redirecting…','success');setTimeout(()=>{window.location.href=getRedirectAfterAuth();},700);})
        .catch(err=>{btn.disabled=false;btn.textContent='Create Account and Continue';showMessage('registerMessage',err.message||'Error','error');});
      return;
    }
    const g=n=>(form.querySelector('[name="'+n+'"]')||{}).value||'';
    const firstname=g('firstname').trim(),lastname=g('lastname').trim(),middlename=g('middlename').trim();
    const email=g('email').trim().toLowerCase(),password=g('password');
    const fullName=[firstname,middlename,lastname].filter(Boolean).join(' ');
    const payload={name:fullName,firstname,lastname,middlename,birthdate:g('birthdate'),gender:g('gender'),civilStatus:g('civilStatus'),nationality:g('nationality'),phone:g('phone'),altPhone:g('altPhone'),address:g('address'),city:g('city'),province:g('province'),buyerType:g('buyerType'),businessName:g('businessName'),industry:g('industry'),orderVolume:g('orderVolume'),govId:g('govId'),govIdNumber:g('govIdNumber'),email,password};
    btn.disabled=true; btn.textContent='Submitting…';
    fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(r=>r.status===201?r.json():r.json().then(j=>{throw new Error(j.error||'Failed');}))
      .then(d=>{
        if(d.message){showMessage('registerMessage','✅ '+d.message,'success');btn.disabled=false;btn.textContent='✓ Submit Registration';return;}
        saveUser(d.user);setToken(d.token);showMessage('registerMessage','✓ Account created! Redirecting…','success');setTimeout(()=>{window.location.href=getRedirectAfterAuth();},900);
      })
      .catch(err=>{btn.disabled=false;btn.textContent='✓ Submit Registration';showMessage('registerMessage',err.message||'Error','error');if((err.message||'').includes('email'))goToStep(3);});
  };
}

function setupLoginForm() {
  const form = document.getElementById('loginForm'); if (!form) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === 'success') showMessage('loginMessage', '✅ Email verified! You can now login.', 'success');
  else if (params.get('verified') === 'expired') showMessage('loginMessage', '⚠️ Verification link expired. Please register again.', 'error');

  const remembered = localStorage.getItem('rememberedEmail');
  if (remembered) {
    const emailEl = document.getElementById('email');
    const rememberEl = document.getElementById('rememberMe');
    if (emailEl) emailEl.value = remembered;
    if (rememberEl) rememberEl.checked = true;
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    const email    = (form.email || form.querySelector('[name=email]')).value.trim().toLowerCase();
    const password = (form.password || form.querySelector('[name=password]')).value;
    const remember = document.getElementById('rememberMe');
    if (!email||!password){showMessage('loginMessage','Punan ang email at password.','error');return;}
    if (remember && remember.checked) localStorage.setItem('rememberedEmail', email);
    else localStorage.removeItem('rememberedEmail');
    const btn=form.querySelector('button[type=submit]');
    btn.disabled=true; btn.textContent='Please wait…';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})})
      .then(r=>r.ok?r.json():r.json().then(j=>{throw new Error(j.error||'Mali ang email o password.');}))
      .then(d=>{
        saveUser(d.user); setToken(d.token);
        showMessage('loginMessage','Login successful! Redirecting…','success');
        setTimeout(()=>{ if(d.user.role==='admin') window.location.href='admin.html'; else window.location.href=getRedirectAfterAuth(); },700);
      })
      .catch(err=>{btn.disabled=false;btn.textContent=document.getElementById('authModal')?'Login and Continue':'Login';showMessage('loginMessage',err.message||'Error','error');});
  };
}

function togglePasswordVisibility() {
  const pw  = document.getElementById('password');
  const btn = document.getElementById('togglePw');
  if (!pw) return;
  if (pw.type === 'password') { pw.type = 'text'; if (btn) btn.textContent = '🙈'; }
  else { pw.type = 'password'; if (btn) btn.textContent = '👁'; }
}

function openForgotPassword() {
  const loginForm   = document.getElementById('loginForm');
  const forgotPanel = document.getElementById('forgotPanel');
  if (loginForm)   loginForm.style.display   = 'none';
  if (forgotPanel) forgotPanel.style.display = 'block';
  const emailEl = document.getElementById('email');
  const resetEl = document.getElementById('resetEmail');
  if (resetEl && emailEl && emailEl.value) resetEl.value = emailEl.value;
}

function closeForgotPassword() {
  const loginForm   = document.getElementById('loginForm');
  const forgotPanel = document.getElementById('forgotPanel');
  if (loginForm)   loginForm.style.display   = 'block';
  if (forgotPanel) forgotPanel.style.display = 'none';
}

function submitForgotPassword() {
  const emailEl = document.getElementById('resetEmail');
  const email   = emailEl ? emailEl.value.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMessage('resetMessage','Please enter a valid email address.','error'); return; }
  const btn = document.querySelector('#forgotPanel .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  fetch('/api/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})})
    .then(()=>{ showMessage('resetMessage','✅ If that email is registered, a password reset link has been sent.','success'); if(btn){btn.disabled=false;btn.textContent='Send Reset Instructions';} })
    .catch(()=>{ showMessage('resetMessage','✅ If that email is registered, a password reset link has been sent.','success'); if(btn){btn.disabled=false;btn.textContent='Send Reset Instructions';} });
}

// ── Order / Inquiry page ──
function setupOrderPage() {
  const form = document.getElementById('orderForm'); if (!form) return;
  const user = getUser();
  if (!user) { window.location.href='products.html'; return; }
  ensureProductsLoaded().then(() => {
    const productId = localStorage.getItem('selectedProduct');
    if (!productId) { window.location.href='products.html'; return; }
    const product = products.find(p=>p.id===productId) || {title:'Selected Product',category:'',price:'',id:productId};
    const titleEl=document.getElementById('orderProductTitle'), metaEl=document.getElementById('orderProductMeta');
    if (titleEl) titleEl.textContent=product.title;
    if (metaEl) metaEl.innerHTML=[product.category,product.price].filter(Boolean).map(p=>'<span>'+p+'</span>').join(' ');
    form.name.value=user.name||''; form.email.value=user.email||'';
    form.onsubmit = function(e) {
      e.preventDefault();
      const btn=form.querySelector('button[type=submit]');
      btn.disabled=true; btn.textContent='Sending…';
      const payload={product:product.title,productId:product.id,name:form.name.value,email:form.email.value,phone:form.phone.value,quantity:form.quantity.value,address:form.address.value,message:form.message.value,buyerId:user.id,buyer:user};
      fetch('/api/orders',{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)})
        .then(r=>r.status===201?r.json():r.json().then(j=>{throw new Error(j.error||'Failed');}))
        .then(()=>{
          localStorage.removeItem('selectedProduct');
          form.reset(); form.name.value=user.name||''; form.email.value=user.email||'';
          btn.disabled=false; btn.textContent='Submit Inquiry';
          showMessage('orderMessage','✓ Inquiry submitted! We will contact you within 24 hours.','success');
        })
        .catch(err=>{btn.disabled=false;btn.textContent='Submit Inquiry';showMessage('orderMessage',err.message||'Failed. Try again.','error');});
    };
  });
}

// ── Buyer Dashboard ──
function setupDashboard() {
  const wrap = document.getElementById('dashboardWrap'); if (!wrap) return;
  const user = getUser();
  if (!user) { window.location.href='login.html'; return; }
  const nameEl = document.getElementById('dashUserName');
  if (nameEl) nameEl.textContent = user.name;

  fetch('/api/my-orders', { headers: authHeaders() })
    .then(r => { if(r.status===401){clearToken();clearUser();window.location.href='login.html';return Promise.reject();} return r.ok?r.json():Promise.reject(); })
    .then(orders => {
      const statsEl = document.getElementById('applicantStats');
      if (statsEl) {
        const total     = orders.length;
        const pending   = orders.filter(o=>o.status==='Pending').length;
        const completed = orders.filter(o=>o.status==='Completed').length;
        statsEl.innerHTML = `
          <div class="applicant-stat-card"><div class="applicant-stat-icon blue">📋</div><div><span class="applicant-stat-num">${total}</span><span class="applicant-stat-label">Total Inquiries</span></div></div>
          <div class="applicant-stat-card"><div class="applicant-stat-icon gold">⏳</div><div><span class="applicant-stat-num">${pending}</span><span class="applicant-stat-label">Pending</span></div></div>
          <div class="applicant-stat-card"><div class="applicant-stat-icon green">✅</div><div><span class="applicant-stat-num">${completed}</span><span class="applicant-stat-label">Completed</span></div></div>`;
      }
      const listEl = document.getElementById('myAppsList'); if (!listEl) return;
      if (!orders.length) {
        listEl.innerHTML=`<div style="text-align:center;padding:32px 20px;"><div style="font-size:2.5rem;margin-bottom:12px;">📦</div><h3 style="margin-bottom:8px;font-size:1rem;">No orders yet</h3><p style="color:var(--muted);font-size:.9rem;margin-bottom:16px;">Browse our products and place an inquiry when ready.</p><a class="btn primary sm" href="products.html">Browse Products →</a></div>`;
        return;
      }
      const statusMap = {'Pending':{cls:'pending',icon:'⏳'},'Processing':{cls:'processing',icon:'⚙️'},'Shipped':{cls:'shipped',icon:'🚚'},'Completed':{cls:'completed',icon:'✅'},'Cancelled':{cls:'cancelled',icon:'❌'}};
      listEl.innerHTML = orders.map(o=>{
        const s = statusMap[o.status] || {cls:'pending',icon:'⏳'};
        return `<div class="app-row">
          <div class="app-row-info"><h4>${o.product}</h4><p>Qty: ${o.quantity || '—'} &nbsp;·&nbsp; ${new Date(o.createdAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</p></div>
          <span class="status-badge ${s.cls}">${s.icon} ${o.status}</span>
        </div>`;
      }).join('');
    })
    .catch(() => {
      const listEl = document.getElementById('myAppsList');
      if (listEl) listEl.innerHTML='<p style="color:var(--muted);">Could not load orders. Please try again later.</p>';
    });

  // Profile form
  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    const u = getUser();
    if (u) { Object.keys(u).forEach(k => { const el=profileForm.querySelector('[name="'+k+'"]'); if(el) el.value=u[k]||''; }); }
    profileForm.onsubmit = function(e) {
      e.preventDefault();
      const btn=this.querySelector('button[type=submit]');
      btn.disabled=true; btn.textContent='Saving…';
      const fd=new FormData(this);
      const body={}; fd.forEach((v,k)=>body[k]=v);
      fetchAuth('/api/profile',{method:'PUT',body:JSON.stringify(body)})
        .then(r=>r.json()).then(u=>{saveUser(u);showMessage('profileMessage','✓ Profile updated.','success');btn.disabled=false;btn.textContent='Save Changes';})
        .catch(()=>{showMessage('profileMessage','Failed to save.','error');btn.disabled=false;btn.textContent='Save Changes';});
    };
  }
}

// ── Admin Dashboard ──
function setupAdminPage() {
  const wrap = document.getElementById('adminWrap'); if (!wrap) return;
  const user = getUser();
  if (!user || user.role !== 'admin') { window.location.href = 'login.html'; return; }

  let allOrders = [], allUsers = [], allProducts = [];

  function switchTab(name) {
    document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('tab-' + name);
    const btn   = document.querySelector('[data-tab="' + name + '"]');
    if (panel) panel.classList.add('active');
    if (btn)   btn.classList.add('active');
  }
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  // Load orders
  fetchAuth('/api/admin/orders').then(r=>r.json()).then(data => {
    allOrders = data;
    const el = document.getElementById('adminOrdersList'); if (!el) return;
    document.getElementById('statTotalOrders').textContent = data.length;
    document.getElementById('statPendingOrders').textContent = data.filter(o=>o.status==='Pending').length;
    document.getElementById('statCompletedOrders').textContent = data.filter(o=>o.status==='Completed').length;
    if (!data.length) { el.innerHTML='<p style="color:var(--muted);padding:16px 0;">No orders yet.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Buyer</th><th>Product</th><th>Qty</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>` +
      data.map(o=>`<tr><td><strong>${o.name}</strong><br><small style="color:var(--muted)">${o.email}</small></td><td>${o.product}</td><td>${o.quantity||'—'}</td><td>${new Date(o.createdAt).toLocaleDateString('en-PH')}</td><td><span class="status-badge ${(o.status||'pending').toLowerCase()}">${o.status}</span></td><td>
        <select onchange="updateOrderStatus('${o.id}',this.value)" style="width:auto;padding:6px 10px;font-size:.82rem;">
          <option ${o.status==='Pending'?'selected':''}>Pending</option>
          <option ${o.status==='Processing'?'selected':''}>Processing</option>
          <option ${o.status==='Shipped'?'selected':''}>Shipped</option>
          <option ${o.status==='Completed'?'selected':''}>Completed</option>
          <option ${o.status==='Cancelled'?'selected':''}>Cancelled</option>
        </select></td></tr>`).join('') + '</tbody></table></div>';
  }).catch(()=>{});

  // Load users
  fetchAuth('/api/admin/users').then(r=>r.json()).then(data => {
    allUsers = data;
    const el = document.getElementById('adminUsersList'); if (!el) return;
    document.getElementById('statTotalUsers').textContent = data.length;
    if (!data.length) { el.innerHTML='<p style="color:var(--muted);padding:16px 0;">No users yet.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Buyer Type</th><th>Registered</th><th>Role</th><th>Action</th></tr></thead><tbody>` +
      data.map(u=>`<tr><td><strong>${u.name}</strong></td><td>${u.email}</td><td>${u.buyerType||'—'}</td><td>${new Date(u.createdAt).toLocaleDateString('en-PH')}</td><td><span class="pill ${u.role==='admin'?'':'retail'}">${u.role}</span></td><td>
        <select onchange="updateUserRole('${u.id}',this.value)" style="width:auto;padding:6px 10px;font-size:.82rem;">
          <option ${u.role==='applicant'?'selected':''} value="applicant">Buyer</option>
          <option ${u.role==='admin'?'selected':''} value="admin">Admin</option>
        </select></td></tr>`).join('') + '</tbody></table></div>';
  }).catch(()=>{});

  // Load products
  fetchAuth('/api/products').then(r=>r.json()).then(data => {
    allProducts = data;
    renderAdminProducts(data);
  }).catch(()=>{});

  window._switchAdminTab = switchTab;
}

function renderAdminProducts(data) {
  const el = document.getElementById('adminProductsList'); if (!el) return;
  if (!data.length) { el.innerHTML='<p style="color:var(--muted);padding:16px 0;">No products yet.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>` +
    data.map(p=>`<tr><td><strong>${p.title}</strong></td><td>${p.category||'—'}</td><td>${p.price}</td><td>${p.stock||'—'}</td><td><span class="pill ${p.status==='active'?'retail':'wholesale'}">${p.status}</span></td><td style="display:flex;gap:6px;">
      <button class="btn ghost sm" onclick="editProduct('${p.id}')">Edit</button>
      <button class="btn sm" style="background:#fff0f0;color:var(--red);border-color:var(--red);" onclick="deleteProduct('${p.id}')">Delete</button>
    </td></tr>`).join('') + '</tbody></table></div>';
}

function updateOrderStatus(id, status) {
  fetchAuth('/api/admin/orders/'+id,{method:'PUT',body:JSON.stringify({status})})
    .then(r=>r.json()).catch(()=>{});
}

function updateUserRole(id, role) {
  fetchAuth('/api/admin/users/'+id+'/role',{method:'PUT',body:JSON.stringify({role})})
    .then(r=>r.json()).catch(()=>{});
}

function showProductForm(product) {
  const modal = document.getElementById('productFormModal');
  if (!modal) return;
  const form = document.getElementById('productForm');
  if (product) {
    form.querySelector('[name=title]').value   = product.title || '';
    form.querySelector('[name=category]').value = product.category || '';
    form.querySelector('[name=price]').value   = product.price || '';
    form.querySelector('[name=stock]').value   = product.stock || 'In Stock';
    form.querySelector('[name=description]').value = product.description || '';
    form.querySelector('[name=tags]').value    = (product.tags||[]).join(', ');
    form.querySelector('[name=status]').value  = product.status || 'active';
    const imgInput = form.querySelector('[name=image]');
    if (imgInput) imgInput.value = product.image || '';
    updateImagePreview(product.image || '');
    form.dataset.editId = product.id;
  } else {
    form.reset();
    updateImagePreview('');
    delete form.dataset.editId;
  }
  modal.classList.add('show');
}

function updateImagePreview(url) {
  const wrap = document.getElementById('imagePreviewWrap');
  const img  = document.getElementById('imagePreview');
  if (!wrap || !img) return;
  if (url) { img.src = url; wrap.style.display = 'block'; }
  else { wrap.style.display = 'none'; img.src = ''; }
}

function closeProductForm() {
  const modal = document.getElementById('productFormModal');
  if (modal) modal.classList.remove('show');
}

function editProduct(id) {
  fetchAuth('/api/products/'+id).then(r=>r.json()).then(p=>showProductForm(p)).catch(()=>{});
}

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  fetchAuth('/api/products/'+id,{method:'DELETE'}).then(()=>location.reload()).catch(()=>{});
}

function setupProductForm() {
  const form = document.getElementById('productForm'); if (!form) return;

  // Live image preview
  const imgInput = form.querySelector('[name=image]');
  if (imgInput) {
    imgInput.addEventListener('input', () => updateImagePreview(imgInput.value.trim()));
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled=true; btn.textContent='Saving…';
    const fd=new FormData(form);
    const body={};
    fd.forEach((v,k)=>body[k]=v);
    body.tags = (body.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
    body.urgent = form.querySelector('[name=urgent]') ? form.querySelector('[name=urgent]').checked : false;
    const editId = form.dataset.editId;
    const url    = editId ? '/api/products/'+editId : '/api/products';
    const method = editId ? 'PUT' : 'POST';
    fetchAuth(url,{method,body:JSON.stringify(body)}).then(r=>r.json()).then(()=>{
      closeProductForm(); location.reload();
    }).catch(()=>{btn.disabled=false;btn.textContent='Save Product';});
  };
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  updateAuthNav();
  setupMenu();
  setupLoginForm();
  setupRegisterForm();
  setupProductsPage();
  setupOrderPage();
  setupDashboard();
  setupAdminPage();
  setupProductForm();
});
