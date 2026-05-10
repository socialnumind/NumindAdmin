/* ================================================================
   NuMind MAPS — Admin Dashboard  (app.js)
   All UI logic: auth, student list, filters, report rendering.
   Talks to the Express API — no hardcoded mock data.
================================================================ */

'use strict';

/* ── State ──────────────────────────────────────────────────────── */
const state = {
  students:    [],
  activeId:    null,
  filter:      'all',
  search:      '',
  school:      '',
  cls:         '',
  debounceTimer: null,
};

/* ── DOM refs ────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const loginView   = $('loginView');
const dashView    = $('dashView');
const loginErr    = $('loginErr');
const loginBtn    = $('loginBtn');
const adminName   = $('adminName');
const statsPills  = $('statsPills');
const studentList = $('studentList');
const studentCount= $('studentCount');
const mainPanel   = $('mainPanel');
const searchInput = $('searchInput');
const filterSchool= $('filterSchool');
const filterClass = $('filterClass');

/* ── Helpers ────────────────────────────────────────────────────── */
const fmt = {
  initials: name => (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
  date:     iso  => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  fitClass: tier => tier === 'Strong Fit' ? 'fit-strong' : tier === 'Emerging Fit' ? 'fit-emerging' : 'fit-exploratory',
  bandClass:band => band === 'Strength' ? 'band-strength' : band === 'Developing' ? 'band-developing' : 'band-needs',
  barColor: s    => s >= 7 ? '#5B2D8E' : s >= 4 ? '#9B6DD4' : '#E24B4A',
  fitInd:   v    => v === 'High' ? 'fi-high' : v === 'Moderate' ? 'fi-moderate' : 'fi-low',
  seaColor: lbl  => {
    if (lbl === 'Strong Readiness')    return { bg: '#EAF3DE', color: '#3B6D11' };
    if (lbl === 'Developing Readiness')return { bg: '#FEF0D8', color: '#854F0B' };
    return                                    { bg: '#FCEBEB', color: '#A32D2D' };
  },
  dotClass:  st  => st === 'Strength' ? 'dot-strength' : st === 'Developing' ? 'dot-developing' : 'dot-support',
  pct:      (raw, max) => max ? Math.round((raw / max) * 100) : 0,
};

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (res.status === 401) { showLogin(); return null; }
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

/* ── Auth ────────────────────────────────────────────────────────── */
function showLogin()  { loginView.classList.remove('hidden'); dashView.classList.add('hidden'); }
function showDash(username) {
  loginView.classList.add('hidden');
  dashView.classList.remove('hidden');
  adminName.textContent = username;
  loadMeta();
  loadStudents();
}

async function checkSession() {
  const data = await api('/auth/me').catch(() => null);
  if (data && data.admin) showDash(data.admin);
  else showLogin();
}

async function doLogin() {
  const username = $('uname').value.trim();
  const password = $('pwd').value;
  if (!username || !password) { loginErr.textContent = 'Enter username and password.'; return; }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';
  loginErr.textContent = '';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      showDash(username);
    } else {
      const err = await res.json();
      loginErr.textContent = err.error || 'Invalid credentials.';
    }
  } catch (e) {
    loginErr.textContent = 'Network error — is the server running?';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  // Reset all state
  state.students = []; state.activeId = null;
  state.search = ''; state.school = ''; state.cls = ''; state.filter = 'all';
  // Reset UI inputs
  $('uname').value = ''; $('pwd').value = '';
  loginErr.textContent = '';
  searchInput.value = '';
  filterSchool.value = '';
  filterClass.value  = '';
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.filter-chip[data-tier="all"]').classList.add('active');
  mainPanel.innerHTML = placeholderHTML();
  showLogin();
}

/* ── Meta / filters ──────────────────────────────────────────────── */
async function loadMeta() {
  const data = await api('/api/students/meta').catch(() => null);
  if (!data) return;

  // Stats pills
  statsPills.innerHTML = `
    <span class="stats-pill">👥 ${data.total} students</span>
    <span class="stats-pill">📋 ${data.withReport} reports</span>
  `;

  // Reset dropdowns before populating (prevents duplicates on repeated calls)
  filterSchool.innerHTML = '<option value="">All schools</option>';
  filterClass.innerHTML  = '<option value="">All classes</option>';

  data.schools.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    filterSchool.appendChild(opt);
  });

  data.classes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = 'Class ' + c;
    filterClass.appendChild(opt);
  });
}

/* ── Student list ────────────────────────────────────────────────── */
async function loadStudents() {
  studentList.innerHTML = '<div class="list-loading">Loading…</div>';
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.school) params.set('school', state.school);
  if (state.cls)    params.set('class',  state.cls);
  if (state.filter !== 'all') params.set('fit_tier', state.filter);

  const data = await api('/api/students?' + params.toString()).catch(() => null);
  if (!data) return;
  state.students = data.students;
  renderList();
}

function renderList() {
  const s = state.students;
  studentCount.textContent = s.length + ' student' + (s.length !== 1 ? 's' : '');
  if (!s.length) {
    studentList.innerHTML = '<div class="list-empty">No students match your filters.</div>';
    return;
  }
  // Use data-id attribute — avoids inline JS and quote-injection risk
  studentList.innerHTML = s.map(st => `
    <div class="student-item${st.session_id === state.activeId ? ' active' : ''}"
         data-id="${esc(st.session_id)}">
      <div class="s-name">${esc(st.full_name)}</div>
      <div class="s-meta">Class ${esc(st.class || '')}${esc(st.section || '')} · ${esc(st.school_city || st.school || '')}</div>
      ${st.fit_tier
        ? `<span class="s-fit ${fmt.fitClass(st.fit_tier)}">${esc(st.fit_tier)}</span>`
        : `<span class="s-fit fit-exploratory">No report yet</span>`}
    </div>
  `).join('');
}

// Single delegated listener on the list container (replaces inline onclick)
studentList.addEventListener('click', e => {
  const item = e.target.closest('.student-item');
  if (item && item.dataset.id) selectStudent(item.dataset.id);
});

/* ── Debounced search ────────────────────────────────────────────── */
function onSearch() {
  clearTimeout(state.debounceTimer);
  state.search = searchInput.value.trim();
  state.debounceTimer = setTimeout(loadStudents, 280);
}

/* ── Filter chips ────────────────────────────────────────────────── */
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter = chip.dataset.tier;
    loadStudents();
  });
});

/* ── Report rendering ────────────────────────────────────────────── */
async function selectStudent(id) {
  state.activeId = id;
  renderList(); // highlight immediately
  mainPanel.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';

  const data = await api('/api/students/' + id).catch(err => {
    mainPanel.innerHTML = `<div class="placeholder"><div class="placeholder-icon">⚠️</div><p>${err.message}</p></div>`;
    return null;
  });
  if (!data) return;

  const { student: s, summary: r, personality, aptitude, interests, seaa, careers } = data;

  // ── helpers ──
  const safeArr = v => Array.isArray(v) ? v : (typeof v === 'string' ? tryParse(v, []) : []);
  const strongPaths     = safeArr(r?.strong_fit_pathways);
  const emergingPaths   = safeArr(r?.emerging_fit_pathways);
  const exploratoryPaths= safeArr(r?.exploratory_pathways);

  const statusRow = (label, st) => `
    <div class="status-row">
      <span class="status-dot ${fmt.dotClass(st)}"></span>${label}
    </div>`;

  // ── Report header ──
  let html = `
    <div class="report-header">
      <div class="rh-left">
        <div class="avatar">${fmt.initials(s.full_name)}</div>
        <div>
          <div class="rh-name">${esc(s.full_name)}</div>
          <div class="rh-sub">Class ${esc(s.class || '')}${esc(s.section || '')} · ${esc(s.school || '')} · ${esc(s.school_city || '')}${s.school_state ? ', ' + esc(s.school_state) : ''}</div>
          <div class="rh-badges">
            <span class="badge badge-purple">${esc(s.gender || '—')} · ${esc(String(s.age || '—'))}y</span>
            <span class="badge badge-gray">Registered ${fmt.date(s.registered_at)}</span>
            ${s.completed_at ? `<span class="badge badge-gray">Completed ${fmt.date(s.completed_at)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="rh-fit">
        ${r ? `
          <div class="fit-score">${r.fit_score ?? '—'}</div>
          <div class="fit-label">Fit Score / 100</div>
          <div class="fit-tier-badge ${fmt.fitClass(r.fit_tier)}">${esc(r.fit_tier || '')}</div>
        ` : '<div class="fit-label" style="color:#AAA">No report generated yet</div>'}
        <button id="admin-pdf-btn" class="pdf-download-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download Report
        </button>
      </div>
    </div>`;

  // ── Stats row ──
  if (r) {
    html += `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val">${r.avg_personality_stanine != null ? Number(r.avg_personality_stanine).toFixed(1) : '—'}</div>
          <div class="stat-lbl">Avg Personality Stanine</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${r.avg_aptitude_stanine != null ? Number(r.avg_aptitude_stanine).toFixed(1) : '—'}</div>
          <div class="stat-lbl">Avg Aptitude Stanine</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${r.top_interest_score ?? '—'}<span style="font-size:13px;color:#AAA">/20</span></div>
          <div class="stat-lbl">Top Interest Score</div>
        </div>
        <div class="stat-card">
          <div class="status-list">
            ${statusRow('Personality', r.personality_status)}
            ${statusRow('Aptitude',    r.aptitude_status)}
            ${statusRow('Interest',    r.interest_status)}
            ${statusRow('SEAA',        r.seaa_status)}
          </div>
        </div>
      </div>`;
  }

  // ── Holistic summary ──
  if (r?.holistic_summary) {
    html += sectionCard('si-purple', '◈', 'Holistic Summary',
      `<div class="prose-block">${esc(r.holistic_summary)}</div>`);
  }

  // ── Personality + Aptitude (two columns) ──
  const persHTML = personality?.length
    ? personality.map(p => barRow(p.name, p.stanine, 9, p.band)).join('')
      + (r?.personality_profile ? `<div class="prose-block" style="margin-top:.75rem">${esc(r.personality_profile)}</div>` : '')
    : '<p class="prose-block">No personality data.</p>';

  const aptHTML = aptitude?.length
    ? aptitude.map(a => barRow(a.name, a.stanine, 9, a.band)).join('')
      + (r?.aptitude_profile ? `<div class="prose-block" style="margin-top:.75rem">${esc(r.aptitude_profile)}</div>` : '')
    : '<p class="prose-block">No aptitude data.</p>';

  html += `<div class="two-col">
    ${sectionCard('si-purple', '⬡', 'Personality Profile (NMAP)', persHTML)}
    ${sectionCard('si-teal',   '◫', 'Aptitude Profile (DAAB)',    aptHTML)}
  </div>`;

  // ── Interests + SEAA (two columns) ──
  const intHTML = interests?.length
    ? interests.map(i => `
        <div class="interest-row">
          <span class="int-rank">${i.rank}</span>
          <span class="int-label">${esc(i.label)}</span>
          <div class="int-bar"><div class="int-bar-fill" style="width:${fmt.pct(i.score,20)}%;background:${i.level==='Strong'?'#5B2D8E':i.level==='Moderate'?'#9B6DD4':'#CCC'}"></div></div>
          <span class="int-score">${i.score}/20</span>
          <span class="int-level ${i.level==='Strong'?'level-strong':i.level==='Moderate'?'level-moderate':'level-low'}">${esc(i.level)}</span>
        </div>`).join('')
      + (r?.interest_profile ? `<div class="prose-block" style="margin-top:.75rem">${esc(r.interest_profile)}</div>` : '')
    : '<p class="prose-block">No interest data.</p>';

  const seaaHTML = seaa?.length
    ? `<div class="seaa-grid">${seaa.map(d => {
        const c = fmt.seaColor(d.cat_label);
        return `<div class="seaa-cell">
          <div class="seaa-title">${esc(d.title)}</div>
          <div class="seaa-score">${d.score ?? '—'}</div>
          <span class="seaa-cat" style="background:${c.bg};color:${c.color}">${esc(d.cat_label || d.category || '—')}</span>
        </div>`;}).join('')}</div>`
      + (r?.wellbeing_guidance ? `<div class="prose-block" style="margin-top:.75rem">${esc(r.wellbeing_guidance)}</div>` : '')
    : '<p class="prose-block">No SEAA data.</p>';

  html += `<div class="two-col">
    ${sectionCard('si-amber', '★', 'Interests (CPI)', intHTML)}
    ${sectionCard('si-blue',  '◉', 'SEAA Adjustment', seaaHTML)}
  </div>`;

  // ── Career fit matrix (grouped by cluster, with rationale) ──
  if (careers?.length) {
    // Group careers by cluster
    const clusterMap = {};
    careers.forEach(c => {
      const key = c.cluster || 'General';
      if (!clusterMap[key]) clusterMap[key] = [];
      clusterMap[key].push(c);
    });

    let careerRows = '';
    Object.entries(clusterMap).forEach(([cluster, rows]) => {
      // Cluster header row
      careerRows += `<tr class="career-cluster-row"><td colspan="7" class="career-cluster-label">${esc(cluster)}</td></tr>`;
      rows.forEach(c => {
        const rationaleId = 'rat-' + Math.random().toString(36).slice(2);
        const hasRationale = !!c.rationale;
        careerRows += `
          <tr>
            <td>
              <div class="career-name">${esc(c.career || c.career_name || '—')}</div>
              <span class="career-align ${fmt.fitClass(c.alignment || c.fit_level)}">${esc(c.alignment || c.fit_level || '')}</span>
              ${hasRationale ? `<button class="rationale-toggle" onclick="
                var el=document.getElementById('${rationaleId}');
                el.style.display=el.style.display==='none'?'table-row':'none';
                this.textContent=el.style.display==='none'?'▸ rationale':'▾ rationale';
              ">▸ rationale</button>` : ''}
            </td>
            <td>${esc(c.cluster || '—')}</td>
            <td><span class="fit-indicator ${fmt.fitInd(c.interest_fit)}">${esc(c.interest_fit)}</span></td>
            <td><span class="fit-indicator ${fmt.fitInd(c.aptitude_fit)}">${esc(c.aptitude_fit)}</span></td>
            <td><span class="fit-indicator ${fmt.fitInd(c.personality_fit)}">${esc(c.personality_fit)}</span></td>
            <td><span class="fit-indicator ${fmt.fitInd(c.seaa_fit)}">${esc(c.seaa_fit)}</span></td>
            <td>
              <div class="pct-bar">
                <span class="pct-num">${c.suitability_pct ?? 0}%</span>
                <div class="pct-mini"><div class="pct-mini-fill" style="width:${c.suitability_pct ?? 0}%"></div></div>
              </div>
            </td>
          </tr>
          ${hasRationale ? `<tr id="${rationaleId}" style="display:none"><td colspan="7" class="career-rationale-cell">${esc(c.rationale)}</td></tr>` : ''}
        `;
      });
    });

    html += sectionCard('si-green', '⊕', 'Career Fit Matrix', `
      <table class="career-table">
        <thead><tr>
          <th>Career</th><th>Cluster</th><th>Interest</th><th>Aptitude</th><th>Personality</th><th>SEAA</th><th>Suitability</th>
        </tr></thead>
        <tbody>${careerRows}</tbody>
      </table>`);
  }

  // ── Pathways + stream advice ──
  if (r?.stream_advice || strongPaths.length || emergingPaths.length || exploratoryPaths.length) {
    html += sectionCard('si-amber', '→', 'Pathway Recommendations', `
      ${r?.stream_advice ? `<div class="prose-block" style="margin-bottom:1rem">${esc(r.stream_advice)}</div>` : ''}
      <div class="pathway-section">
        ${pathwayGroup('Strong Fit',   strongPaths,      'pc-strong')}
        ${pathwayGroup('Emerging Fit', emergingPaths,    'pc-emerging')}
        ${pathwayGroup('Exploratory',  exploratoryPaths, 'pc-exploratory')}
      </div>`);
  }

  mainPanel.innerHTML = html;

  // ── Wire PDF download button (rendered inside report header) ──
  const dlBtn = document.getElementById('admin-pdf-btn');
  if (dlBtn) {
    dlBtn.addEventListener('click', () => {
      dlBtn.classList.add('loading');
      dlBtn.disabled = true;
      import('./js/admin-report.js')
        .then(m => m.generateAdminReport(data))
        .finally(() => { dlBtn.classList.remove('loading'); dlBtn.disabled = false; });
    });
  }
}

/* ── Sub-renderers ───────────────────────────────────────────────── */
function sectionCard(iconCls, icon, title, body) {
  return `
    <div class="section-card">
      <div class="section-title">
        <span class="section-icon ${iconCls}">${icon}</span>${esc(title)}
      </div>
      ${body}
    </div>`;
}

function barRow(label, stanine, max, band) {
  const pct   = Math.round((stanine / max) * 100);
  const color = fmt.barColor(stanine);
  return `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-val">${stanine}</div>
      <span class="bar-band ${fmt.bandClass(band)}">${esc(band)}</span>
    </div>`;
}

function pathwayGroup(label, items, cls) {
  return `
    <div class="pathway-group">
      <div class="pathway-label">${esc(label)}</div>
      <div class="pathway-chips">
        ${items.length
          ? items.map(p => `<span class="pchip ${cls}">${esc(p)}</span>`).join('')
          : '<span class="no-pathway">None identified</span>'}
      </div>
    </div>`;
}

function placeholderHTML() {
  return `<div class="placeholder">
    <div class="placeholder-icon">⊞</div>
    <div class="ph-title">Select a student</div>
    <p>Click any student on the left to view their full assessment report</p>
  </div>`;
}

/* ── XSS safety ──────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/* ── Event wiring ────────────────────────────────────────────────── */
loginBtn.addEventListener('click', doLogin);
$('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('uname').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('logoutBtn').addEventListener('click', doLogout);
searchInput.addEventListener('input', onSearch);
filterSchool.addEventListener('change', () => { state.school = filterSchool.value; loadStudents(); });
filterClass.addEventListener('change',  () => { state.cls   = filterClass.value;  loadStudents(); });

/* ── Boot ────────────────────────────────────────────────────────── */
checkSession();
