// ── Chozen Resources Inc. — Frontend App ──

let jobs = window.fallbackJobs || [];

// ── Auth helpers ──
function getToken()         { return localStorage.getItem('authToken') || ''; }
function setToken(t)        { localStorage.setItem('authToken', t); }
function clearToken()       { localStorage.removeItem('authToken'); }
function getUser()          { try { return JSON.parse(localStorage.getItem('currentUser')); } catch(e) { return null; } }
function saveUser(u)        { localStorage.setItem('currentUser', JSON.stringify(u)); }
function clearUser()        { localStorage.removeItem('currentUser'); }
function authHeaders()      { return { 'Content-Type': 'application/json', 'x-auth-token': getToken() }; }

// Auto-logout on 401
function fetchAuth(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { 'x-auth-token': getToken() });
  if (!opts.headers['Content-Type'] && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
  }
  return fetch(url, opts).then(r => {
    if (r.status === 401) {
      clearToken(); clearUser();
      window.location.href = 'login.html';
      return Promise.reject(new Error('Session expired. Please login again.'));
    }
    return r;
  });
}

function logout() {
  fetch('/api/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  clearToken(); clearUser();
  localStorage.removeItem('selectedJob');
  window.location.href = 'index.html';
}

function showMessage(id, text, status) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.className = 'message ' + status; }
}

// Update nav: show "Dashboard" + "Logout" if logged in
function updateAuthNav() {
  const user = getUser();
  document.querySelectorAll('[data-auth-link]').forEach(el => {
    if (user) {
      el.textContent = 'Logout (' + user.name.split(' ')[0] + ')';
      el.href = '#'; el.onclick = e => { e.preventDefault(); logout(); };
    } else {
      el.textContent = 'Login'; el.href = 'login.html'; el.onclick = null;
    }
  });
  // Show/hide dashboard link
  document.querySelectorAll('[data-dash-link]').forEach(el => {
    if (user) {
      el.style.display = '';
      el.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html';
    } else {
      el.style.display = 'none';
    }
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

  // Close menu when a nav link is clicked
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      btn.textContent = '☰';
      btn.setAttribute('aria-label', 'Open menu');
    });
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.remove('open');
      btn.textContent = '☰';
      btn.setAttribute('aria-label', 'Open menu');
    }
  });
}

// ── Jobs ──
function displayJobs() {
  const list   = document.getElementById('jobList');
  const search = document.getElementById('jobSearch');
  const type   = document.getElementById('jobType');
  const count  = document.getElementById('jobCount');
  if (!list) return;
  const q  = (search ? search.value : '').toLowerCase();
  const t  = type ? type.value : 'all';
  const filtered = jobs.filter(j => (j.status !== 'closed') && (j.title + ' ' + j.location).toLowerCase().includes(q) && (t === 'all' || j.type === t));

  // Update count
  if (count) count.textContent = filtered.length + ' job' + (filtered.length !== 1 ? 's' : '') + ' found';

  if (!filtered.length) {
    list.innerHTML = `
      <div class="jobs-empty">
        <div class="jobs-empty-icon">🔍</div>
        <h3>No jobs found</h3>
        <p>Try a different search term or job type filter.</p>
      </div>`;
    return;
  }
  let html = '';
  filtered.forEach(job => {
    const pillClass = job.type === 'Contract' ? 'pill contract' : job.type === 'Part-time' ? 'pill part-time' : 'pill';
    const badge = job.urgent ? '<span class="pill" style="background:#fff0f0;color:#c0392b;margin-left:6px;">🔥 Urgent</span>' : '';
    html += `<article class="job-card">
      <div class="job-card-top"><span class="${pillClass}">${job.type}</span>${badge}<span class="location-tag">📍 ${job.location}</span></div>
      <h2><a href="job.html?id=${job.id}" style="color:inherit;">${job.title}</a></h2>
      <p>${job.description}</p>
      <strong>${job.salary}</strong>
      <div class="tag-list">${(job.tags||[]).map(t => '<span>' + t + '</span>').join('')}</div>
      <div style="display:flex;gap:8px;margin-top:auto;">
        <a class="btn ghost sm" href="job.html?id=${job.id}" style="flex:1;text-align:center;">View Details</a>
        <button class="btn primary sm" style="flex:1;" onclick="applyJob('${job.id}')">Apply Now</button>
      </div>
    </article>`;
  });
  list.innerHTML = html;
}

function fetchJobs() {
  return fetch('/api/jobs').then(r => r.ok ? r.json() : Promise.reject()).then(d => { jobs = d; })
    .catch(() => { jobs = window.fallbackJobs || []; });
}

function setupJobsPage() {
  if (!document.getElementById('jobList')) return;
  const search = document.getElementById('jobSearch');
  const type   = document.getElementById('jobType');
  fetchJobs().then(() => {
    if (search) search.oninput = displayJobs;
    if (type)   type.onchange  = displayJobs;
    displayJobs();
  });
}

function ensureJobsLoaded() { return jobs.length ? Promise.resolve() : fetchJobs(); }

function applyJob(jobId) {
  localStorage.setItem('selectedJob', jobId);
  if (getUser()) { window.location.href = 'apply.html'; } else { openAuthBox(); }
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

function getRedirectAfterAuth() { return localStorage.getItem('selectedJob') ? 'apply.html' : 'dashboard.html'; }

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
  const el = document.getElementById('step-' + idx);
  if (!el) return true;
  let ok = true;
  el.querySelectorAll('input[required],select[required]').forEach(i => {
    i.style.borderColor = '';
    if (!i.value.trim()) { i.style.borderColor = 'var(--red)'; if (ok) i.focus(); ok = false; }
  });
  if (!ok) { showMessage('registerMessage','Punan ang lahat ng required fields.','error'); return false; }
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
    if (p) { p.classList.remove('active','done'); if (i===idx) p.classList.add('active'); else if(i<idx) p.classList.add('done'); }
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
  const rows = [['First Name',g('firstname')],['Last Name',g('lastname')],['Middle Name',g('middlename')],['Birthdate',g('birthdate')],['Gender',g('gender')],['Civil Status',g('civilStatus')],['Nationality',g('nationality')],['Mobile',g('phone')],['Address',g('address')+', '+g('city')+', '+g('province')],['Education',g('education')],['Course',g('course')||'—'],['Experience',g('experience')+' yr(s)'],['Availability',g('availability')],['Skills',g('skills')],['Gov ID',g('govId')+' – '+g('govIdNumber')],['Email',g('email')],['Password','••••••••']];
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
    const payload={name:fullName,firstname,lastname,middlename,birthdate:g('birthdate'),gender:g('gender'),civilStatus:g('civilStatus'),nationality:g('nationality'),phone:g('phone'),altPhone:g('altPhone'),address:g('address'),city:g('city'),province:g('province'),education:g('education'),course:g('course'),experience:g('experience'),availability:g('availability'),skills:g('skills'),govId:g('govId'),govIdNumber:g('govIdNumber'),email,password};
    btn.disabled=true; btn.textContent='Submitting…';
    fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(r=>r.status===201?r.json():r.json().then(j=>{throw new Error(j.error||'Failed');}))
      .then(d=>{
        if (d.message) {
          // Email verification required
          showMessage('registerMessage', '✅ ' + d.message, 'success');
          btn.disabled = false; btn.textContent = '✓ Submit Registration';
          return;
        }
        saveUser(d.user);setToken(d.token);showMessage('registerMessage','✓ Account created! Redirecting…','success');setTimeout(()=>{window.location.href=getRedirectAfterAuth();},900);
      })
      .catch(err=>{btn.disabled=false;btn.textContent='✓ Submit Registration';showMessage('registerMessage',err.message||'Error','error');if((err.message||'').includes('email'))goToStep(3);});
  };
}

function setupLoginForm() {
  const form = document.getElementById('loginForm'); if (!form) return;

  // Show verification messages from URL
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === 'success') {
    showMessage('loginMessage', '✅ Email verified! You can now login.', 'success');
  } else if (params.get('verified') === 'expired') {
    showMessage('loginMessage', '⚠️ Verification link expired. Please register again.', 'error');
  } else if (params.get('verified') === 'fail') {
    showMessage('loginMessage', '❌ Invalid verification link.', 'error');
  }

  // Restore remembered email
  const remembered = localStorage.getItem('rememberedEmail');
  if (remembered) {
    const emailEl = document.getElementById('email');
    const rememberEl = document.getElementById('rememberMe');
    if (emailEl) emailEl.value = remembered;
    if (rememberEl) rememberEl.checked = true;
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    const email    = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    const remember = document.getElementById('rememberMe');
    if (!email||!password){showMessage('loginMessage','Punan ang email at password.','error');return;}

    // Handle remember me
    if (remember && remember.checked) {
      localStorage.setItem('rememberedEmail', email);
    } else {
      localStorage.removeItem('rememberedEmail');
    }

    const btn=form.querySelector('button[type=submit]');
    btn.disabled=true; btn.textContent='Please wait…';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})})
      .then(r=>r.ok?r.json():r.json().then(j=>{throw new Error(j.error||'Mali ang email o password.');}))
      .then(d=>{
        saveUser(d.user); setToken(d.token);
        showMessage('loginMessage','Login successful! Redirecting…','success');
        setTimeout(()=>{
          if (d.user.role==='admin') { window.location.href='admin.html'; }
          else { window.location.href=getRedirectAfterAuth(); }
        },700);
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
  const resetMsg    = document.getElementById('resetMessage');
  const resetEmail  = document.getElementById('resetEmail');
  if (loginForm)   loginForm.style.display   = 'none';
  if (forgotPanel) forgotPanel.style.display = 'block';
  if (resetMsg)    resetMsg.textContent       = '';
  // Pre-fill email if already entered
  const emailEl = document.getElementById('email');
  if (resetEmail && emailEl && emailEl.value) resetEmail.value = emailEl.value;
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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage('resetMessage', 'Please enter a valid email address.', 'error'); return;
  }
  const btn = document.querySelector('#forgotPanel .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  fetch('/api/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  .then(() => {
    showMessage('resetMessage', '✅ If that email is registered, a password reset link has been sent. Please check your inbox.', 'success');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
  })
  .catch(() => {
    showMessage('resetMessage', '✅ If that email is registered, a password reset link has been sent.', 'success');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
  });
}

// ── Apply page ──
function setupApplyPage() {
  const form = document.getElementById('applicationForm'); if (!form) return;
  const user = getUser();
  if (!user) { window.location.href='jobs.html'; return; }
  ensureJobsLoaded().then(() => {
    const jobId = localStorage.getItem('selectedJob');
    if (!jobId) { window.location.href='jobs.html'; return; }
    const job = jobs.find(j=>j.id===jobId) || {title:'Selected Job',location:'',type:'',salary:'',id:jobId};
    const titleEl=document.getElementById('applyJobTitle'), metaEl=document.getElementById('applyJobMeta');
    if (titleEl) titleEl.textContent=job.title;
    if (metaEl) metaEl.innerHTML=[job.location,job.type,job.salary].filter(Boolean).map(p=>'<span>'+p+'</span>').join(' ');
    form.name.value=user.name||''; form.email.value=user.email||'';
    // Resume upload with drag-drop
    const resumeInput   = document.getElementById('resumeFile');
    const resumeDropZone = document.getElementById('resumeDropZone');
    let resumeFilename = '';

    function handleResumeFile(file) {
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['pdf','doc','docx'].includes(ext)) {
        showMessage('applicationMessage','Only PDF, DOC, or DOCX files are allowed.','error'); return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showMessage('applicationMessage','File is too large. Maximum size is 5MB.','error'); return;
      }
      const xl = document.getElementById('resumeStatus');
      if (xl) xl.textContent = 'Uploading…';
      const fd = new FormData();
      fd.append('resume', file, file.name);
      fetch('/api/apply/upload', { method:'POST', headers:{'x-auth-token':getToken()}, body:fd })
        .then(r=>r.json())
        .then(d=>{
          resumeFilename = d.filename;
          if (xl) xl.innerHTML = '✅ <strong>' + file.name + '</strong> uploaded successfully.';
          if (resumeDropZone) resumeDropZone.style.borderColor = 'var(--green)';
        })
        .catch(()=>{ if(xl) xl.textContent = '❌ Upload failed. Try again.'; });
    }

    if (resumeInput) {
      resumeInput.onchange = function() { handleResumeFile(this.files[0]); };
    }

    if (resumeDropZone) {
      resumeDropZone.addEventListener('dragover', e=>{ e.preventDefault(); resumeDropZone.style.borderColor='var(--blue)'; });
      resumeDropZone.addEventListener('dragleave', ()=>{ resumeDropZone.style.borderColor='var(--line)'; });
      resumeDropZone.addEventListener('drop', e=>{
        e.preventDefault();
        resumeDropZone.style.borderColor='var(--line)';
        const file = e.dataTransfer.files[0];
        if (file) handleResumeFile(file);
      });
    }
    form.onsubmit = function(e) {
      e.preventDefault();
      if (!resumeFilename) {
        showMessage('applicationMessage','Please upload your Resume / CV before submitting.','error');
        document.getElementById('resumeDropZone').style.borderColor='var(--red)';
        document.getElementById('resumeDropZone').scrollIntoView({behavior:'smooth',block:'center'});
        return;
      }
      const btn=form.querySelector('button[type=submit]');
      btn.disabled=true; btn.textContent='Sending…';
      const payload={job:job.title,jobId:job.id,name:form.name.value,email:form.email.value,phone:form.phone.value,experience:form.experience.value,address:form.address.value,message:form.message.value,resumeFile:resumeFilename,applicantId:user.id,applicant:user};
      fetch('/api/apply',{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)})
        .then(r=>r.status===201?r.json():r.json().then(j=>{throw new Error(j.error||'Failed');}))
        .then(()=>{
          localStorage.removeItem('selectedJob');
          form.reset(); form.name.value=user.name||''; form.email.value=user.email||'';
          resumeFilename='';
          btn.disabled=false; btn.textContent='Submit Application';
          showMessage('applicationMessage','✓ Application submitted successfully! We will review your application and contact you within 24 hours.','success');
        })
        .catch(err=>{btn.disabled=false;btn.textContent='Submit Application';showMessage('applicationMessage',err.message||'Failed. Try again.','error');});
    };
  });
}

// ── Job detail page ──
function setupJobDetailPage() {
  const wrap = document.getElementById('jobDetailWrap'); if (!wrap) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { wrap.innerHTML='<p>Job not found.</p>'; return; }
  fetch('/api/jobs/' + id).then(r=>r.ok?r.json():Promise.reject()).then(job=>{
    document.title = job.title + ' — Chozen Resources Inc.';

    // Populate sticky bar
    _stickyJobId = job.id;
    const stickyBar   = document.getElementById('stickyApplyBar');
    const stickyTitle = document.getElementById('stickyJobTitle');
    const stickySal   = document.getElementById('stickySalary');
    if (stickyBar)   stickyBar.style.display = '';
    if (stickyTitle) stickyTitle.textContent = job.title;
    if (stickySal)   stickySal.textContent   = job.salary;
    const pillClass = job.type==='Contract'?'pill contract':job.type==='Part-time'?'pill part-time':'pill';
    wrap.innerHTML=`
      <div class="job-detail-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <span class="${pillClass}">${job.type}</span>
          ${job.urgent ? '<span class="pill" style="background:#fff0f0;color:#c0392b;">🔥 Urgent</span>' : ''}
        </div>
        <h1>${job.title}</h1>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:10px;">
          <span style="color:rgba(255,255,255,.8);font-size:.92rem;">📍 ${job.location}</span>
          <span style="color:#6ee7b7;font-size:1rem;font-weight:800;">${job.salary}</span>
        </div>
      </div>
      <div class="job-detail-layout">
        <div class="job-detail-main">
          <div class="form-section">
            <h3>Job Description</h3>
            <p style="color:var(--sub);line-height:1.85;white-space:pre-wrap;">${job.description}</p>
            ${job.fullDescription?'<p style="color:var(--sub);line-height:1.85;margin-top:14px;white-space:pre-wrap;">'+job.fullDescription+'</p>':''}
          </div>
          ${(job.tags&&job.tags.length)?`
          <div class="form-section">
            <h3>Skills & Requirements</h3>
            <div class="tag-list" style="margin:0;">${job.tags.map(t=>'<span>'+t+'</span>').join('')}</div>
          </div>`:''}
          ${job.qualifications?`
          <div class="form-section">
            <h3>Job Qualifications</h3>
            <p style="color:var(--sub);line-height:1.85;white-space:pre-wrap;">${job.qualifications}</p>
          </div>`:''}
          <div class="form-section" style="background:var(--green-lt);border-color:#b7e1cc;">
            <h3 style="color:var(--green-dk);font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;">Why Apply at Chozen?</h3>
            <ul style="list-style:none;display:grid;gap:8px;">
              <li style="font-size:.88rem;color:var(--green-dk);display:flex;gap:8px;align-items:center;"><span style="color:var(--green);font-weight:900;">✓</span> Free for all applicants — no fees ever</li>
              <li style="font-size:.88rem;color:var(--green-dk);display:flex;gap:8px;align-items:center;"><span style="color:var(--green);font-weight:900;">✓</span> 24-hour application review turnaround</li>
              <li style="font-size:.88rem;color:var(--green-dk);display:flex;gap:8px;align-items:center;"><span style="color:var(--green);font-weight:900;">✓</span> Verified employers only</li>
              <li style="font-size:.88rem;color:var(--green-dk);display:flex;gap:8px;align-items:center;"><span style="color:var(--green);font-weight:900;">✓</span> DOLE & SEC Registered Agency</li>
            </ul>
          </div>
        </div>
        <aside class="job-detail-sidebar">
          <div class="job-sidebar-card">
            <h4>Job Overview</h4>
            <div class="job-meta-item"><div class="job-meta-icon">💼</div><div><small style="color:var(--muted);font-size:.74rem;font-weight:700;text-transform:uppercase;">Job Type</small><div style="font-weight:700;font-size:.9rem;">${job.type}</div></div></div>
            <div class="job-meta-item"><div class="job-meta-icon green">📍</div><div><small style="color:var(--muted);font-size:.74rem;font-weight:700;text-transform:uppercase;">Location</small><div style="font-weight:700;font-size:.9rem;">${job.location}</div></div></div>
            <div class="job-meta-item"><div class="job-meta-icon gold">💰</div><div><small style="color:var(--muted);font-size:.74rem;font-weight:700;text-transform:uppercase;">Salary</small><div style="font-weight:700;font-size:.9rem;color:var(--green);">${job.salary}</div></div></div>
          </div>
          <div class="job-sidebar-card">
            <h4>Quick Apply</h4>
            <p style="font-size:.85rem;color:var(--muted);margin-bottom:14px;">Our team will contact you within 24 hours.</p>
            <button class="btn primary full" onclick="applyJob('${job.id}')">Apply Now →</button>
          </div>
        </aside>
      </div>`;
  }).catch(()=>{ wrap.innerHTML='<div class="jobs-empty"><div class="jobs-empty-icon">😕</div><h3>Job not found</h3><p>This job may no longer be available. <a href="jobs.html" style="color:var(--blue);font-weight:700;">Browse other jobs →</a></p></div>'; });
}

// ── Applicant Dashboard ──
function setupDashboard() {
  const wrap = document.getElementById('dashboardWrap'); if (!wrap) return;
  const user = getUser();
  if (!user) { window.location.href='login.html'; return; }
  const nameEl = document.getElementById('dashUserName');
  if (nameEl) nameEl.textContent = user.name;

  fetch('/api/my-applications', { headers: authHeaders() })
    .then(r => {
      if (r.status === 401) { clearToken(); clearUser(); window.location.href='login.html'; return Promise.reject(); }
      return r.ok ? r.json() : Promise.reject();
    })
    .then(apps => {
      // Stats
      const statsEl = document.getElementById('applicantStats');
      if (statsEl) {
        const total    = apps.length;
        const pending  = apps.filter(a=>a.status==='Pending').length;
        const hired    = apps.filter(a=>a.status==='Hired').length;
        statsEl.innerHTML = `
          <div class="applicant-stat-card">
            <div class="applicant-stat-icon blue">📋</div>
            <div><span class="applicant-stat-num">${total}</span><span class="applicant-stat-label">Total Applications</span></div>
          </div>
          <div class="applicant-stat-card">
            <div class="applicant-stat-icon gold">⏳</div>
            <div><span class="applicant-stat-num">${pending}</span><span class="applicant-stat-label">Pending Review</span></div>
          </div>
          <div class="applicant-stat-card">
            <div class="applicant-stat-icon green">✅</div>
            <div><span class="applicant-stat-num">${hired}</span><span class="applicant-stat-label">Hired</span></div>
          </div>`;
      }

      const listEl = document.getElementById('myAppsList'); if (!listEl) return;
      if (!apps.length) {
        listEl.innerHTML=`<div style="text-align:center;padding:32px 20px;">
          <div style="font-size:2.5rem;margin-bottom:12px;">📂</div>
          <h3 style="margin-bottom:8px;font-size:1rem;">No applications yet</h3>
          <p style="color:var(--muted);font-size:.9rem;margin-bottom:16px;">Start browsing jobs and apply when you find a good fit.</p>
          <a class="btn primary sm" href="jobs.html">Browse Jobs →</a>
        </div>`;
        return;
      }
      const statusMap = {
        'Pending':      { cls:'pending',   icon:'⏳' },
        'For Interview':{ cls:'interview', icon:'📅' },
        'Hired':        { cls:'hired',     icon:'✅' },
        'Rejected':     { cls:'rejected',  icon:'❌' }
      };
      listEl.innerHTML = apps.map(a=>{
        const s = statusMap[a.status] || { cls:'pending', icon:'⏳' };
        const canWithdraw = a.status === 'Pending';
        return `<div class="app-row">
          <div class="app-row-info">
            <strong>${a.job}</strong>
            <span>Applied: ${new Date(a.createdAt).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="app-status-badge ${s.cls}">${s.icon} ${a.status}</span>
            ${canWithdraw ? `<button class="btn sm ghost" style="font-size:.75rem;padding:4px 10px;color:var(--red);border-color:var(--red);" onclick="withdrawApplication('${a.id}','${a.job}')">Withdraw</button>` : ''}
          </div>
        </div>`;
      }).join('');
    })
    .catch(()=>{ const l=document.getElementById('myAppsList'); if(l) l.innerHTML='<p style="color:var(--red);">Could not load applications.</p>'; });

  setupProfileEdit(user);
}

function setupProfileEdit(user) {
  const form = document.getElementById('profileForm'); if (!form) return;
  // Pre-fill fields
  ['name','phone','address','city','province','skills','availability'].forEach(k=>{
    const el=form.querySelector('[name="'+k+'"]'); if(el) el.value=user[k]||'';
  });
  form.onsubmit = function(e) {
    e.preventDefault();
    const btn=form.querySelector('button[type=submit]'); btn.disabled=true; btn.textContent='Saving…';
    const body={};
    ['name','phone','address','city','province','skills','availability'].forEach(k=>{
      const el=form.querySelector('[name="'+k+'"]'); if(el) body[k]=el.value;
    });
    fetch('/api/profile',{method:'PUT',headers:authHeaders(),body:JSON.stringify(body)})
      .then(r=>r.ok?r.json():r.json().then(j=>{throw new Error(j.error);}))
      .then(u=>{ saveUser(u); btn.disabled=false; btn.textContent='Save Changes'; showMessage('profileMessage','✓ Profile updated!','success'); updateAuthNav(); })
      .catch(err=>{ btn.disabled=false; btn.textContent='Save Changes'; showMessage('profileMessage',err.message||'Error','error'); });
  };
}

// ── Admin Dashboard ──
function setupAdminDashboard() {
  if (!document.getElementById('adminWrap')) return;
  const user = getUser();
  if (!user || user.role !== 'admin') { window.location.href='login.html'; return; }

  loadAnalytics(); loadAdminApplications(); loadAdminJobs(); loadAdminNotifications();

  // Tab switching
  document.querySelectorAll('.admin-tab-btn').forEach(btn=>{
    btn.onclick = function() {
      switchTab(this.dataset.tab);
    };
  });
}

function loadAnalytics() {
  fetch('/api/admin/analytics',{headers:authHeaders()}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('stat-applicants',d.totalApplicants);
    set('stat-applications',d.totalApplications);
    set('stat-month',d.thisMonth);
    set('stat-jobs',d.activeJobs);
    set('stat-topjob',d.topJob);
    set('stat-pending',d.byStatus.Pending||0);
    set('stat-interview',d.byStatus['For Interview']||0);
    set('stat-hired',d.byStatus.Hired||0);
    set('stat-rejected',d.byStatus.Rejected||0);
  }).catch(()=>{});
}

function loadAdminApplications(filter='') {
  const wrap=document.getElementById('adminAppsTable'); if(!wrap) return;
  wrap.innerHTML='<p style="color:var(--muted);padding:20px;">Loading…</p>';
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.ok?r.json():Promise.reject()).then(apps=>{
    const search = (document.getElementById('appSearchInput')||{}).value||'';
    const status = (document.getElementById('appStatusFilter')||{}).value||'';
    let filtered = apps;
    if (search) filtered = filtered.filter(a=>a.name.toLowerCase().includes(search.toLowerCase())||a.job.toLowerCase().includes(search.toLowerCase())||(a.email||'').toLowerCase().includes(search.toLowerCase()));
    if (status) filtered = filtered.filter(a=>a.status===status);
    if(!filtered.length){wrap.innerHTML='<p style="color:var(--muted);padding:20px;">No applications found.</p>';return;}
    const statuses=['Pending','For Interview','Hired','Rejected'];
    const statusColor={'Pending':'var(--gold)','For Interview':'var(--blue)','Hired':'var(--green)','Rejected':'var(--red)'};
    wrap.innerHTML=`<table class="admin-table"><thead><tr><th>Date</th><th>Applicant</th><th>Job Applied</th><th>Contact</th><th>Resume</th><th>Status</th><th>Actions</th></tr></thead><tbody>`+
      filtered.map(a=>`<tr>
        <td style="white-space:nowrap;">${new Date(a.createdAt).toLocaleDateString('en-PH')}</td>
        <td><strong>${a.name}</strong><br><small style="color:var(--muted);">${a.email}</small></td>
        <td>${a.job}</td>
        <td>${a.phone||'—'}</td>
        <td>${a.resumeFile?`<a href="/uploads/${a.resumeFile}" target="_blank" class="btn ghost sm" style="font-size:.75rem;padding:5px 10px;">📄 View</a>`:'<span style="color:var(--muted);font-size:.82rem;">None</span>'}</td>
        <td><select class="status-select" style="color:${statusColor[a.status]||'var(--muted)'};" data-id="${a.id}" onchange="updateAppStatus('${a.id}',this.value)">${statuses.map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn sm ghost" onclick="viewApplicant('${a.id}')">👁 View</button></td>
      </tr>`).join('')+
      '</tbody></table>';
  }).catch(()=>{wrap.innerHTML='<p style="color:var(--red);padding:20px;">Failed to load.</p>';});
}

function updateAppStatus(id,status) {
  fetch('/api/admin/applications/'+id,{method:'PUT',headers:authHeaders(),body:JSON.stringify({status})})
    .then(r=>r.ok?r.json():Promise.reject())
    .then(()=>{ loadAnalytics(); })
    .catch(()=>alert('Failed to update status'));
}

function viewApplicant(id) {
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.json()).then(apps=>{
    const a=apps.find(x=>x.id===id); if(!a) return;
    const statusColor={'Pending':'var(--gold)','For Interview':'var(--blue)','Hired':'var(--green)','Rejected':'var(--red)'};
    const fields = [
      ['👤 Full Name', a.name],
      ['📧 Email', a.email],
      ['📞 Phone', a.phone||'—'],
      ['💼 Applied For', a.job],
      ['📅 Date Applied', new Date(a.createdAt).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})],
      ['🏠 Address', a.address||'—'],
      ['📚 Experience', a.experience ? a.experience + ' year(s)' : '—'],
      ['💬 Cover Message', a.message||'—'],
    ];
    const modal=document.getElementById('viewModal');
    const body=document.getElementById('viewModalBody');
    const actions=document.getElementById('viewModalActions');
    if(body) body.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px;padding:14px 16px;background:var(--paper);border-radius:10px;border:1px solid var(--line);">
        <div>
          <strong style="font-size:1.1rem;">${a.name}</strong>
          <div style="font-size:.85rem;color:var(--muted);">${a.email}</div>
        </div>
        <span style="font-weight:800;color:${statusColor[a.status]||'var(--muted)'};">● ${a.status}</span>
      </div>
      <div style="display:grid;gap:10px;">
        ${fields.map(([label,val])=>`
          <div style="display:grid;grid-template-columns:160px 1fr;gap:8px;font-size:.88rem;padding:8px 0;border-bottom:1px solid var(--line);">
            <span style="color:var(--muted);font-weight:700;">${label}</span>
            <span style="color:var(--ink);font-weight:600;word-break:break-word;">${val}</span>
          </div>`).join('')}
      </div>`;
    if(actions) actions.innerHTML=`
      ${a.resumeFile?`<a href="/uploads/${a.resumeFile}" target="_blank" class="btn primary sm">📄 Download Resume</a>`:''}
      <select class="status-select" style="flex:1;max-width:200px;" onchange="updateAppStatus('${a.id}',this.value);this.closest('.modal').querySelectorAll('span')[1].textContent='● '+this.value;">
        ${['Pending','For Interview','Hired','Rejected'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="btn ghost sm" onclick="closeViewModal()">Close</button>`;
    // Add notes section
    const notesDiv = document.createElement('div');
    notesDiv.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid var(--line);';
    notesDiv.innerHTML = `
      <label style="font-weight:700;font-size:.85rem;display:block;margin-bottom:8px;">📝 Admin Notes</label>
      <textarea id="note-${a.id}" rows="3" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-size:.88rem;" placeholder="Add notes about this applicant…">${a.adminNote||''}</textarea>
      <button class="btn primary sm" style="margin-top:8px;" onclick="saveApplicantNote('${a.id}')">Save Note</button>`;
    if(body) body.appendChild(notesDiv);
    if(modal) modal.classList.add('show');
  });
}
function closeViewModal(){ const m=document.getElementById('viewModal');if(m)m.classList.remove('show'); }

function loadAdminJobs() { loadAdminJobsFiltered(''); }

function confirmDeleteJob(id, title) {
  showConfirm('Delete Job Listing', `Are you sure you want to delete "<strong>${title}</strong>"? This cannot be undone.`, () => deleteJob(id), 'Delete', 'var(--red)');
}

function deleteJob(id){
  fetch('/api/jobs/'+id,{method:'DELETE',headers:authHeaders()}).then(()=>{ loadAdminJobs(); showToast('Job deleted.'); }).catch(()=>showToast('Failed to delete.'));
}

function toggleJob(id,status){
  const newStatus=status==='closed'?'active':'closed';
  fetch('/api/jobs/'+id,{method:'PUT',headers:authHeaders(),body:JSON.stringify({status:newStatus})})
    .then(()=>{ loadAdminJobs(); showToast(newStatus==='active'?'Job reopened.':'Job closed.'); }).catch(()=>showToast('Failed.'));
}

// ── Custom confirm dialog ──
function showConfirm(title, message, onConfirm, confirmText = 'Confirm', confirmColor = 'var(--blue)') {
  let modal = document.getElementById('customConfirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customConfirmModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-box" style="width:min(420px,100%);text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
        <h3 id="confirmTitle" style="font-size:1.1rem;margin-bottom:8px;"></h3>
        <p id="confirmMsg" style="font-size:.9rem;color:var(--muted);margin-bottom:24px;"></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn ghost" onclick="document.getElementById('customConfirmModal').classList.remove('show')">Cancel</button>
          <button class="btn primary" id="confirmOkBtn">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').innerHTML = message;
  const okBtn = document.getElementById('confirmOkBtn');
  okBtn.textContent = confirmText;
  okBtn.style.background = confirmColor;
  okBtn.style.borderColor = confirmColor;
  okBtn.onclick = () => { modal.classList.remove('show'); onConfirm(); };
  modal.classList.add('show');
}
function exportCSV(){ window.location.href='/api/admin/export/csv?token='+getToken(); }
function filterApps(){ loadAdminApplications(); }

function quickFilter(status) {
  // Switch to applications tab
  switchTab('applications');
  // Set the status filter
  const sel = document.getElementById('appStatusFilter');
  if (sel) sel.value = status;
  // If month filter
  if (status === 'month') {
    if (sel) sel.value = '';
    const search = document.getElementById('appSearchInput');
    if (search) search.value = '';
  }
  loadAdminApplications();
  // Scroll to table
  setTimeout(() => {
    const panel = document.getElementById('panel-applications');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function switchTab(tabName) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.admin-tab-btn[data-tab="${tabName}"]`);
  const panel = document.getElementById('panel-' + tabName);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
  if (tabName === 'export') setupExportPanel();
  if (tabName === 'staff') loadStaff();
  if (tabName === 'settings') loadApplicantsList();
  if (tabName === 'users') { loadUsers(); loadAdminEmails(); }
}

// ── Export / Print panel ──
let _exportData = [];

function setupExportPanel() {
  // Populate job filter dropdown
  fetch('/api/jobs').then(r=>r.json()).then(jobs=>{
    const sel = document.getElementById('exp-job'); if(!sel) return;
    jobs.forEach(j=>{
      const o = document.createElement('option');
      o.value = j.title; o.textContent = j.title;
      sel.appendChild(o);
    });
  }).catch(()=>{});
}

function getExportFilters() {
  return {
    status: (document.getElementById('exp-status')||{}).value||'',
    job:    (document.getElementById('exp-job')||{}).value||'',
    search: ((document.getElementById('exp-search')||{}).value||'').toLowerCase()
  };
}

function applyExportFilters(apps) {
  const f = getExportFilters();
  return apps.filter(a => {
    if (f.status && a.status !== f.status) return false;
    if (f.job    && a.job !== f.job)       return false;
    if (f.search && !a.name.toLowerCase().includes(f.search) && !a.email.toLowerCase().includes(f.search)) return false;
    return true;
  });
}

function previewExport() {
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.json()).then(apps=>{
    _exportData = applyExportFilters(apps);
    const info = document.getElementById('exp-preview-info');
    if(info) {
      info.style.display = 'block';
      info.innerHTML = `✓ Found <strong>${_exportData.length}</strong> application${_exportData.length!==1?'s':''} matching your filters. Ready to export or print.`;
    }
  }).catch(()=>showToast('Failed to load applications.'));
}

function doExportCSV() {
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.json()).then(apps=>{
    const data = applyExportFilters(apps);
    if(!data.length){ showToast('No data to export.'); return; }
    const headers = ['Name','Email','Phone','Job Applied','Status','Experience','Address','Date Applied'];
    const rows = data.map(a=>[
      a.name, a.email, a.phone||'', a.job, a.status,
      (a.experience||'')+ ' yr(s)', a.address||'',
      new Date(a.createdAt).toLocaleDateString('en-PH')
    ].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'applications_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ CSV downloaded!');
  }).catch(()=>showToast('Export failed.'));
}

function buildPrintHTML(data, title) {
  const statusColor={'Pending':'#b45309','For Interview':'#1d4ed8','Hired':'#166534','Rejected':'#991b1b'};
  return `
    <html><head><title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 20px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 11px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; }
      td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      tr:nth-child(even) td { background: #f8fafc; }
      .badge { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
      .logo { font-size: 16px; font-weight: 900; margin-bottom: 2px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #1a4fd6; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="header">
      <div>
        <div class="logo">Chozen Resources Inc.</div>
        <div class="meta">Manpower & Placement Agency</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;">${title}</div>
        <div class="meta">Generated: ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div>
        <div class="meta">Total Records: ${data.length}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Contact</th><th>Job Applied</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>
        ${data.map((a,i)=>`<tr>
          <td>${i+1}</td>
          <td><strong>${a.name}</strong><br><span style="color:#666;">${a.email}</span></td>
          <td>${a.phone||'—'}</td>
          <td>${a.job}</td>
          <td><span class="badge" style="color:${statusColor[a.status]||'#333'};background:${statusColor[a.status]||'#333'}22;">${a.status}</span></td>
          <td>${new Date(a.createdAt).toLocaleDateString('en-PH')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:24px;font-size:10px;color:#999;text-align:center;">
      Chozen Resources Inc. — Confidential Document — Page 1
    </div>
    </body></html>`;
}

function doPrint() {
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.json()).then(apps=>{
    const data = applyExportFilters(apps);
    if(!data.length){ showToast('No data to print.'); return; }
    const f = getExportFilters();
    const title = 'Applications Report' + (f.status?' — '+f.status:'') + (f.job?' — '+f.job:'');
    const win = window.open('','_blank');
    win.document.write(buildPrintHTML(data, title));
    win.document.close();
    win.focus();
    setTimeout(()=>win.print(), 600);
  }).catch(()=>showToast('Print failed.'));
}

function doSavePDF() {
  fetch('/api/admin/applications',{headers:authHeaders()}).then(r=>r.json()).then(apps=>{
    const data = applyExportFilters(apps);
    if(!data.length){ showToast('No data to save.'); return; }
    const f = getExportFilters();
    const title = 'Applications Report' + (f.status?' — '+f.status:'') + (f.job?' — '+f.job:'');
    const win = window.open('','_blank');
    win.document.write(buildPrintHTML(data, title));
    win.document.close();
    win.focus();
    showToast('💡 In the print dialog, choose "Save as PDF"');
    setTimeout(()=>win.print(), 600);
  }).catch(()=>showToast('Failed.'));
}
function editJob(id){
  fetch('/api/jobs/'+id).then(r=>r.json()).then(job=>{
    const fields = {'edit-title':'title','edit-location':'location','edit-type':'type','edit-salary':'salary','edit-desc':'description','edit-fulldesc':'fullDescription','edit-qualifications':'qualifications'};
    Object.entries(fields).forEach(([elId,key])=>{ const el=document.getElementById(elId); if(el) el.value=job[key]||''; });
    const tagsEl=document.getElementById('edit-tags'); if(tagsEl) tagsEl.value=(job.tags||[]).join(', ');
    const urgentEl=document.getElementById('edit-urgent'); if(urgentEl) urgentEl.checked=!!job.urgent;
    const form=document.getElementById('editJobForm'); if(form) form.dataset.id=id;
    const modal=document.getElementById('editJobModal'); if(modal) modal.classList.add('show');
  });
}
function closeEditJob(){ const m=document.getElementById('editJobModal');if(m)m.classList.remove('show'); }
function saveJobEdit(){
  const form=document.getElementById('editJobForm'); if(!form) return;
  const id=form.dataset.id;
  const tagsRaw=(document.getElementById('edit-tags')||{}).value||'';
  const tags=tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
  const urgent=(document.getElementById('edit-urgent')||{}).checked||false;
  const body={
    title:document.getElementById('edit-title').value,
    location:document.getElementById('edit-location').value,
    type:document.getElementById('edit-type').value,
    salary:document.getElementById('edit-salary').value,
    description:document.getElementById('edit-desc').value,
    fullDescription:document.getElementById('edit-fulldesc').value,
    qualifications:(document.getElementById('edit-qualifications')||{}).value||'',
    tags, urgent
  };
  fetch('/api/jobs/'+id,{method:'PUT',headers:authHeaders(),body:JSON.stringify(body)})
    .then(()=>{ closeEditJob(); loadAdminJobs(); showToast('✓ Job updated!'); })
    .catch(()=>alert('Save failed'));
}

// ── Pre-approved Admin Emails ──
function loadAdminEmails() {
  fetch('/api/admin/approved-emails', { headers: authHeaders() })
    .then(r => r.json()).then(emails => {
      const wrap = document.getElementById('adminEmailList'); if (!wrap) return;
      if (!emails.length) { wrap.innerHTML = '<p style="color:var(--muted);">No pre-approved admin emails yet.</p>'; return; }
      wrap.innerHTML = `<table class="admin-table">
        <thead><tr><th>Email</th><th>Action</th></tr></thead>
        <tbody>${emails.map(e => `<tr>
          <td><strong>${e}</strong></td>
          <td><button class="btn sm" style="background:var(--red);color:#fff;border-color:var(--red);" onclick="removeAdminEmail('${e}')">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
    }).catch(() => {});
}

function addAdminEmail() {
  const input = document.getElementById('newAdminEmail');
  const email = (input?.value || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage('adminEmailMsg', 'Invalid email.', 'error'); return;
  }
  fetch('/api/admin/approved-emails', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email })
  })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(() => { input.value = ''; loadAdminEmails(); showToast('✓ Admin email added!'); showMessage('adminEmailMsg', '', ''); })
  .catch(() => showMessage('adminEmailMsg', 'Failed to add.', 'error'));
}

function removeAdminEmail(email) {
  showConfirm('Remove Admin Email', `Remove "<strong>${email}</strong>" from pre-approved list?`, () => {
    fetch('/api/admin/approved-emails/' + encodeURIComponent(email), { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadAdminEmails(); showToast('Admin email removed.'); })
      .catch(() => showToast('Failed.'));
  }, 'Remove', 'var(--red)');
}

// ── Users & Roles Management ──
let _allUsers = [];

function loadUsers() {
  fetch('/api/admin/users', { headers: authHeaders() })
    .then(r => r.json()).then(users => {
      _allUsers = users;
      renderUsers(users);
    }).catch(() => {});
}

function filterUsers() {
  const q    = (document.getElementById('userSearchInput')||{}).value?.toLowerCase()||'';
  const role = (document.getElementById('userRoleFilter')||{}).value||'';
  const filtered = _allUsers.filter(u =>
    (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
    (!role || u.role === role)
  );
  renderUsers(filtered);
}

function renderUsers(users) {
  const wrap = document.getElementById('usersList'); if (!wrap) return;
  if (!users.length) { wrap.innerHTML = '<p style="color:var(--muted);padding:12px 0;">No users found.</p>'; return; }
  const roleColor = { admin: 'var(--blue)', applicant: 'var(--green)' };
  const roleBg    = { admin: 'var(--blue-lt)', applicant: 'var(--green-lt)' };
  wrap.innerHTML = `<table class="admin-table">
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Registered</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td><strong>${u.name}</strong></td>
      <td style="font-size:.85rem;">${u.email}</td>
      <td style="font-size:.85rem;">${u.phone||'—'}</td>
      <td><span style="background:${roleBg[u.role]||'var(--paper)'};color:${roleColor[u.role]||'var(--muted)'};padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:800;text-transform:uppercase;">${u.role}</span></td>
      <td style="font-size:.82rem;">${new Date(u.createdAt).toLocaleDateString('en-PH')}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          ${u.role === 'applicant'
            ? `<button class="btn sm" style="background:var(--blue);color:#fff;border-color:var(--blue);padding:5px 10px;" onclick="changeUserRole('${u.id}','admin','${u.name}')">Promote to Admin</button>`
            : `<button class="btn sm ghost" style="padding:5px 10px;" onclick="changeUserRole('${u.id}','applicant','${u.name}')">Set as Applicant</button>`
          }
          <button class="btn sm" style="background:var(--red);color:#fff;border-color:var(--red);padding:5px 10px;" onclick="deleteUserConfirm('${u.id}','${u.name}')">Delete</button>
        </div>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function changeUserRole(id, newRole, name) {
  const action = newRole === 'admin' ? 'promote to Admin' : 'set as Applicant';
  showConfirm('Change Role', `Change role of "<strong>${name}</strong>" to <strong>${newRole}</strong>?`, () => {
    fetch('/api/admin/users/' + id + '/role', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ role: newRole })
    })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(() => { loadUsers(); showToast(`✓ ${name} is now ${newRole}.`); })
    .catch(() => showToast('Failed to update role.'));
  }, 'Yes, Change Role', 'var(--blue)');
}

function deleteUserConfirm(id, name) {
  showConfirm('Delete User', `Permanently delete account of "<strong>${name}</strong>"?`, () => {
    fetch('/api/admin/users/' + id, { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadUsers(); showToast('User deleted.'); })
      .catch(() => showToast('Failed to delete.'));
  }, 'Delete', 'var(--red)');
}
function loadStaff() {
  fetch('/api/admin/users', { headers: authHeaders() })
    .then(r => r.json()).then(users => {
      const staff = users.filter(u => u.role === 'admin' || u.role === 'staff');
      const wrap = document.getElementById('staffList'); if (!wrap) return;
      if (!staff.length) {
        wrap.innerHTML = '<p style="color:var(--muted);padding:12px 0;">No staff accounts yet. Create one above.</p>';
        return;
      }
      wrap.innerHTML = `<table class="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>${staff.map(u => `<tr>
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td><span style="background:var(--blue-lt);color:var(--blue);padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:800;">${u.role}</span></td>
          <td>${new Date(u.createdAt).toLocaleDateString('en-PH')}</td>
          <td><button class="btn sm" style="background:var(--red);color:#fff;border-color:var(--red);" onclick="deleteStaff('${u.id}','${u.name}')">🗑 Remove</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
    }).catch(() => {});
}

function addStaff() {
  const name  = (document.getElementById('staff-name')||{}).value?.trim();
  const email = (document.getElementById('staff-email')||{}).value?.trim().toLowerCase();
  const pass  = (document.getElementById('staff-password')||{}).value;
  if (!name || !email || !pass) { showMessage('staffMsg', 'Please fill in all fields.', 'error'); return; }
  if (pass.length < 8) { showMessage('staffMsg', 'Password must be at least 8 characters.', 'error'); return; }

  fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: pass, role: 'admin' })
  })
  .then(r => r.status === 201 ? r.json() : r.json().then(j => { throw new Error(j.error || 'Failed'); }))
  .then(() => {
    showMessage('staffMsg', '✓ Staff account created!', 'success');
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-password').value = '';
    loadStaff();
    showToast('✓ Staff account created!');
  })
  .catch(err => showMessage('staffMsg', err.message || 'Failed.', 'error'));
}

function deleteStaff(id, name) {
  showConfirm('Remove Staff Account', `Remove staff account for "<strong>${name}</strong>"?`, () => {
    fetch('/api/admin/users/' + id, { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadStaff(); showToast('Staff account removed.'); })
      .catch(() => showToast('Failed to remove staff.'));
  }, 'Remove', 'var(--red)');
}

// ── Settings ──
function loadApplicantsList() {
  fetch('/api/admin/users', { headers: authHeaders() })
    .then(r => r.json()).then(users => {
      const applicants = users.filter(u => u.role === 'applicant');
      const wrap = document.getElementById('applicantsList'); if (!wrap) return;
      if (!applicants.length) { wrap.innerHTML = '<p style="color:var(--muted);">No registered applicants yet.</p>'; return; }
      wrap.innerHTML = `<table class="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Registered</th><th>Action</th></tr></thead>
        <tbody>${applicants.map(u => `<tr>
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td>${u.phone || '—'}</td>
          <td>${new Date(u.createdAt).toLocaleDateString('en-PH')}</td>
          <td><button class="btn sm" style="background:var(--red);color:#fff;border-color:var(--red);" onclick="deleteApplicant('${u.id}','${u.name}')">🗑 Delete</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
    }).catch(() => {});
}

function deleteApplicant(id, name) {
  showConfirm('Delete Account', `Delete account for "<strong>${name}</strong>"? All their data will be removed.`, () => {
    fetch('/api/admin/users/' + id, { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadApplicantsList(); showToast('Account deleted.'); })
      .catch(() => showToast('Failed to delete.'));
  }, 'Delete', 'var(--red)');
}

function clearAllApplications() {
  showConfirm('Clear All Applications', 'Permanently delete ALL application records? This cannot be undone.', () => {
    fetch('/api/admin/clear-applications', { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadAdminApplications(); loadAnalytics(); showToast('All applications cleared.'); })
      .catch(() => showToast('Failed.'));
  }, 'Clear All', 'var(--red)');
}

function filterAdminJobs() {
  const q = (document.getElementById('jobSearchAdmin')||{}).value||'';
  loadAdminJobsFiltered(q);
}

function withdrawApplication(id, job) {
  showConfirm('Withdraw Application', `Withdraw your application for "<strong>${job}</strong>"? This cannot be undone.`, () => {
    fetch('/api/withdraw/' + id, { method: 'DELETE', headers: authHeaders() })
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error); }))
      .then(() => { showToast('Application withdrawn.'); setupDashboard(); })
      .catch(err => showToast(err.message || 'Failed to withdraw.'));
  }, 'Withdraw', 'var(--red)');
}

// ── Admin notification badge ──
function loadAdminNotifications() {
  if (!document.getElementById('adminWrap')) return;
  fetch('/api/admin/analytics', { headers: authHeaders() })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => {
      const pending = d.byStatus?.Pending || 0;
      // Update tab badge
      const appTab = document.querySelector('.admin-tab-btn[data-tab="applications"]');
      if (appTab) {
        appTab.innerHTML = pending > 0
          ? `Applications <span style="background:var(--red);color:#fff;border-radius:999px;padding:1px 7px;font-size:.72rem;margin-left:6px;">${pending}</span>`
          : 'Applications';
      }
    }).catch(() => {});
}

// ── Admin notes per applicant ──
function saveApplicantNote(appId) {
  const note = document.getElementById('note-' + appId)?.value || '';
  fetch('/api/admin/applications/' + appId, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ adminNote: note })
  })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(() => showToast('✓ Note saved!'))
  .catch(() => showToast('Failed to save note.'));
}

function filterAdminJobs() {
  const q = (document.getElementById('jobSearchAdmin')||{}).value||'';
  loadAdminJobsFiltered(q);
}

function loadAdminJobsFiltered(q='') {
  const wrap=document.getElementById('adminJobsTable'); if(!wrap) return;
  fetch('/api/jobs').then(r=>r.json()).then(allJobs=>{
    const jobs = q ? allJobs.filter(j=>j.title.toLowerCase().includes(q.toLowerCase())||j.location.toLowerCase().includes(q.toLowerCase())) : allJobs;
    if(!jobs.length){wrap.innerHTML='<p style="padding:20px;color:var(--muted);">No jobs found.</p>';return;}
    wrap.innerHTML=`<table class="admin-table"><thead><tr><th>Title</th><th>Location</th><th>Type</th><th>Salary</th><th>Tags</th><th>Status</th><th>Actions</th></tr></thead><tbody>`+
      jobs.map(j=>`<tr>
        <td><strong>${j.title}</strong>${j.urgent?' <span style="color:var(--red);font-size:.75rem;font-weight:800;">🔥 URGENT</span>':''}</td>
        <td>${j.location}</td><td>${j.type}</td><td>${j.salary}</td>
        <td><div style="display:flex;flex-wrap:wrap;gap:4px;">${(j.tags||[]).map(t=>'<span style="background:var(--blue-lt);color:var(--blue);padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700;">'+t+'</span>').join('')||'<span style="color:var(--muted);font-size:.82rem;">—</span>'}</div></td>
        <td><span style="color:${j.status==='closed'?'var(--red)':'var(--green)'};font-weight:800;">${j.status==='closed'?'Closed':'Active'}</span></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;">
            <button class="btn sm ghost" style="padding:5px 12px;" onclick="editJob('${j.id}')">✏️ Edit</button>
            <button class="btn sm" style="background:var(--red);color:#fff;border-color:transparent;padding:5px 10px;" onclick="confirmDeleteJob('${j.id}','${j.title.replace(/'/g,'')}')">🗑 Delete</button>
          </div>
        </td>
      </tr>`).join('')+
      '</tbody></table>';
  });
}
function addNewJob(){
  const form=document.getElementById('newJobForm'); if(!form) return;
  const tagsRaw=(document.getElementById('new-tags')||{}).value||'';
  const tags=tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
  const urgent=(document.getElementById('new-urgent')||{}).checked||false;
  const body={
    title:document.getElementById('new-title').value,
    location:document.getElementById('new-location').value,
    type:document.getElementById('new-type').value,
    salary:document.getElementById('new-salary').value,
    description:document.getElementById('new-desc').value,
    fullDescription:(document.getElementById('new-fulldesc')||{}).value||'',
    qualifications:(document.getElementById('new-qualifications')||{}).value||'',
    tags, urgent
  };
  fetch('/api/jobs',{method:'POST',headers:authHeaders(),body:JSON.stringify(body)})
    .then(r=>r.status===201?r.json():Promise.reject())
    .then(()=>{
      form.reset();
      loadAdminJobs();
      showMessage('newJobMsg','✓ Job published successfully!','success');
      showToast('✓ Job listing published!');
    })
    .catch(()=>showMessage('newJobMsg','Failed to add job.','error'));
}

function previewNewJob() {
  const title = document.getElementById('new-title').value || 'Job Title';
  const type  = document.getElementById('new-type').value  || 'Full-time';
  const loc   = document.getElementById('new-location').value || 'Location';
  const sal   = document.getElementById('new-salary').value || 'Salary';
  const desc  = document.getElementById('new-desc').value  || 'No description.';
  const tagsRaw = (document.getElementById('new-tags')||{}).value||'';
  const tags  = tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
  const urgent= (document.getElementById('new-urgent')||{}).checked;
  const pillClass = type==='Contract'?'pill contract':type==='Part-time'?'pill part-time':'pill';
  const body = document.getElementById('jobPreviewBody');
  if(body) body.innerHTML=`
    <div style="background:linear-gradient(135deg,#0f2d6b,#1a56db);border-radius:14px;padding:24px;margin-bottom:16px;">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <span class="${pillClass}">${type}</span>
        ${urgent?'<span class="pill" style="background:#fff0f0;color:#c0392b;">🔥 Urgent</span>':''}
      </div>
      <h2 style="color:#fff;margin-bottom:6px;">${title}</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <span style="color:rgba(255,255,255,.8);font-size:.9rem;">📍 ${loc}</span>
        <span style="color:#6ee7b7;font-weight:800;">${sal}</span>
      </div>
    </div>
    <div class="form-section" style="margin-bottom:12px;">
      <h3>Description</h3>
      <p style="color:var(--sub);line-height:1.8;">${desc}</p>
    </div>
    ${tags.length?`<div class="form-section"><h3>Skills & Tags</h3><div class="tag-list">${tags.map(t=>'<span>'+t+'</span>').join('')}</div></div>`:''}`;
  const modal = document.getElementById('jobPreviewModal');
  if(modal) modal.classList.add('show');
}
function closeJobPreview(){ const m=document.getElementById('jobPreviewModal');if(m)m.classList.remove('show'); }

// ── Scroll reveal ──
function setupScrollReveal() {
  const targets = [
    '.section-hd', '.card', '.step', '.mission-card',
    '.obj-item', '.benefit-item', '.stat-box', '.cta-banner',
    '.apply-header', '.form-section', '.dash-section',
    '.org-node-staff', '.footer-brand-col', '.footer-col'
  ];
  targets.forEach(sel => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(i * 0.08, 0.5) + 's';
    });
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ── Header scroll shadow ──
function setupHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
}

// ── Init ──
// ── Floating particles in hero ──
function setupHeroParticles() {
  const hero = document.querySelector('.hero');
  if (!hero) return;

  // Add scroll indicator
  const scrollInd = document.createElement('div');
  scrollInd.className = 'scroll-indicator';
  scrollInd.innerHTML = `<span>SCROLL</span><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`;
  scrollInd.onclick = () => window.scrollBy({ top: window.innerHeight - 80, behavior: 'smooth' });
  hero.style.position = 'relative';
  hero.appendChild(scrollInd);

  // Create floating particles
  const count = 18;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'hero-particle';
    const size = Math.random() * 18 + 6;
    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${Math.random() * 100}%;
      animation-duration: ${Math.random() * 10 + 8}s;
      animation-delay: ${Math.random() * 10}s;
      opacity: ${Math.random() * .15 + .05};
    `;
    hero.appendChild(p);
  }
}

// ── Service Gallery ──
const serviceGalleries = {
  manpower: {
    title: '👷 Manpower Provider',
    photos: [
      { url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80', caption: 'Skilled workers ready for deployment' },
      { url: 'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&w=800&q=80', caption: 'Professional workforce management' },
      { url: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=800&q=80', caption: 'Reliable manpower solutions' },
      { url: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=800&q=80', caption: 'Team briefing and coordination' },
      { url: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=800&q=80', caption: 'Worker placement and support' },
      { url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80', caption: 'D.O. 174 compliant staffing' },
    ]
  },
  subcontracting: {
    title: '🏭 Product Process Sub-Contracting',
    photos: [
      { url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=800&q=80', caption: 'Manufacturing operations' },
      { url: 'https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?auto=format&fit=crop&w=800&q=80', caption: 'Quality control processes' },
      { url: 'https://images.unsplash.com/photo-1533073526757-2c8ca1df9f1c?auto=format&fit=crop&w=800&q=80', caption: 'Product assembly line' },
      { url: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=800&q=80', caption: 'Industrial operations' },
      { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80', caption: 'Process monitoring' },
      { url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=800&q=80', caption: 'ISO quality standards' },
    ]
  },
  construction: {
    title: '🏗️ Construction Services',
    photos: [
      { url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80', caption: 'Construction site operations' },
      { url: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=800&q=80', caption: 'Building infrastructure' },
      { url: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=800&q=80', caption: 'Skilled construction workers' },
      { url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=800&q=80', caption: 'Project site management' },
      { url: 'https://images.unsplash.com/photo-1510125594188-5a6e7e3d7dfe?auto=format&fit=crop&w=800&q=80', caption: 'Renovation projects' },
      { url: 'https://images.unsplash.com/photo-1512207736890-6ffed8a84e8d?auto=format&fit=crop&w=800&q=80', caption: 'Infrastructure development' },
    ]
  },
  security: {
    title: '🛡️ Safety & Security Watchmen',
    photos: [
      { url: 'https://images.unsplash.com/photo-1461772599978-be9ebcdd5e3b?auto=format&fit=crop&w=800&q=80', caption: 'Professional security personnel' },
      { url: 'https://images.unsplash.com/photo-1547941126-3d5322b218b0?auto=format&fit=crop&w=800&q=80', caption: 'Facility monitoring and protection' },
      { url: 'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=800&q=80', caption: 'Safety compliance and standards' },
      { url: 'https://images.unsplash.com/photo-1564182842519-8a3b2af3e228?auto=format&fit=crop&w=800&q=80', caption: '24/7 security coverage' },
      { url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=800&q=80', caption: 'Trained watchmen deployment' },
      { url: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=800&q=80', caption: 'Asset and personnel protection' },
    ]
  }
};

function openServiceGallery(type) {
  const data = serviceGalleries[type]; if (!data) return;
  document.getElementById('galleryTitle').textContent = data.title;
  document.getElementById('galleryGrid').innerHTML = data.photos.map(p => `
    <div style="border-radius:10px;overflow:hidden;position:relative;cursor:pointer;" onclick="openFullPhoto('${p.url}')">
      <img src="${p.url}" alt="${p.caption}" style="width:100%;height:160px;object-fit:cover;display:block;transition:transform .3s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));padding:8px 10px;">
        <p style="color:#fff;font-size:.75rem;margin:0;font-weight:600;">${p.caption}</p>
      </div>
    </div>`).join('');
  const modal = document.getElementById('serviceGalleryModal');
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.classList.add('show');
}

function closeServiceGallery() {
  document.getElementById('serviceGalleryModal').classList.remove('show');
}

function openFullPhoto(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.5);">`;
  overlay.onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}

// ── Back to top button ──
function setupBackToTop() {
  const btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.title = 'Back to top';
  btn.innerHTML = '↑';
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 300);
  }, { passive: true });
}

// ── Toast notification ──
function showToast(msg, duration = 2500) {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Copy phone — enhanced with toast ──
function copyPhone(num, el) {
  const formatted = num.replace(/(\d{4})(\d{3})(\d{4})/, '$1-$2-$3');
  navigator.clipboard.writeText(num).then(() => {
    showToast('📋 Copied: ' + formatted);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = num; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast('📋 Copied: ' + formatted);
  });
}

// ── Sticky apply bar ──
let _stickyJobId = '';
function applyStickyJob() { if (_stickyJobId) applyJob(_stickyJobId); }

// ── Keyboard accessibility ──
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close any open modal
      document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
      // Close mobile nav
      const nav = document.querySelector('.site-nav');
      const btn = document.querySelector('.nav-toggle');
      if (nav && nav.classList.contains('open')) {
        nav.classList.remove('open');
        if (btn) { btn.textContent = '☰'; btn.setAttribute('aria-label', 'Open menu'); }
      }
    }
  });
}

// Run all setup functions
setupMenu();
updateAuthNav();
setupScrollReveal();
setupHeaderScroll();
setupHeroParticles();
setupBackToTop();
setupKeyboard();
(function applyQueryParam(){
  const q=new URLSearchParams(window.location.search).get('q');
  if(!q) return;
  const b=document.getElementById('jobSearch'); if(b) b.value=q;
  const h=document.getElementById('headerSearchInput'); if(h) h.value=q;
})();
setupJobsPage();
setupRegisterForm();
setupLoginForm();
setupApplyPage();
setupDashboard();
setupAdminDashboard();
setupJobDetailPage();

function headerSearch(e) {
  e.preventDefault();
  const q=(document.getElementById('headerSearchInput')||{}).value||'';
  if (!q.trim()) { window.location.href='jobs.html'; return; }
  window.location.href='jobs.html?q='+encodeURIComponent(q.trim());
}

// (copyPhone is defined above with toast support)
