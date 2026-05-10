/**
 * NuMind MAPS — Express API Server
 * =================================
 * Retrieves EVERY piece of information stored in d6.db — no hardcoding,
 * no silent omissions. All JSON blobs in the assessments table are parsed
 * and merged into the response so the frontend has the full picture.
 *
 * Tables fully served:
 *   students            → /api/students, /api/students/:id
 *   report_summary      → /api/students/:id  (all 29 columns)
 *   report_personality  → /api/students/:id  (name fixed from position map)
 *   report_aptitude     → /api/students/:id  (all 8 columns)
 *   report_interests    → /api/students/:id  (all ranks, enriched with pct)
 *   report_seaa         → /api/students/:id  (all 6 columns + detail_level)
 *   report_careers      → /api/students/:id  (all 11 columns, aliased)
 *   assessments         → /api/students/:id  (parsed JSON per module)
 *   section_progress    → /api/students/:id
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const Database   = require('better-sqlite3');
const path       = require('path');

const DB_PATH        = process.env.DB_PATH;
const PORT           = process.env.PORT || process.env.ADMIN_PORT;  // Render injects PORT automatically
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USERS    = { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD };

if (!DB_PATH)        throw new Error('DB_PATH is not set');
if (!PORT)           throw new Error('PORT / ADMIN_PORT is not set');
if (!SESSION_SECRET) throw new Error('SESSION_SECRET is not set');

// Position → canonical trait name (confirmed from DB inspection)
const PERSONALITY_TRAITS = [
  'Leadership & Motivation',    // 0  id=ld
  'Assertiveness',              // 1  id=as
  'Cautiousness',               // 2  id=ca
  'Adaptability & Flexibility', // 3  id=ad
  'Ethical Awareness',          // 4  id=et
  'Creativity & Innovation',    // 5  id=cr
  'Curiosity & Learning',       // 6  id=cu
  'Discipline & Sincerity',     // 7  id=ds
  'Patience & Resilience',      // 8  id=pr
];

const STANINE_LABELS = new Set([
  'Very High','Above Average','Slightly Above Avg','Slightly Above Average',
  'Average','Slightly Below Avg','Slightly Below Average',
  'Below Average','Very Low','Needs Attention',
]);

function traitName(row) {
  return (STANINE_LABELS.has(row.name) || !row.name)
    ? (PERSONALITY_TRAITS[row.position] ?? row.name)
    : row.name;
}

function topTraits(rows, n = 3) {
  return rows
    .slice()
    .sort((a, b) => b.stanine - a.stanine || a.position - b.position)
    .slice(0, n)
    .map(r => ({ name: r.name, stanine: r.stanine, label: r.band, raw: r.raw, pct: r.pct }));
}

function tryParse(str, fallback = null) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
}));

function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

// ── Auth ──────────────────────────────────────────────────────────

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });
  if (ADMIN_USERS[username] === password) {
    req.session.admin = username;
    return res.json({ ok: true, admin: username });
  }
  res.status(401).json({ error: 'Invalid credentials.' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ admin: req.session.admin });
});

// ── Meta ──────────────────────────────────────────────────────────

app.get('/api/students/meta', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
    const withReport = db.prepare(
      `SELECT COUNT(*) AS c FROM students s
       INNER JOIN report_summary rs ON s.session_id = rs.session_id`
    ).get().c;
    const schools = db.prepare(
      `SELECT DISTINCT school FROM students WHERE school IS NOT NULL AND school != '' ORDER BY school`
    ).all().map(r => r.school);
    const classes = db.prepare(
      `SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != '' ORDER BY class`
    ).all().map(r => r.class);
    const fitTiers = db.prepare(
      `SELECT DISTINCT fit_tier FROM report_summary WHERE fit_tier IS NOT NULL ORDER BY fit_tier`
    ).all().map(r => r.fit_tier);

    res.json({ total, withReport, schools, classes, fitTiers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Student list ──────────────────────────────────────────────────

app.get('/api/students', requireAuth, (req, res) => {
  try {
    const { search, school, class: cls, fit_tier } = req.query;
    let sql = `
      SELECT
        s.session_id, s.full_name, s.first_name, s.last_name,
        s.class, s.section, s.school, s.school_city, s.school_state,
        s.age, s.gender, s.email, s.registered_at, s.completed_at, s.report_generated_at,
        rs.fit_score, rs.fit_tier, rs.is_fallback,
        rs.personality_status, rs.aptitude_status, rs.interest_status, rs.seaa_status
      FROM students s
      LEFT JOIN report_summary rs ON s.session_id = rs.session_id
      WHERE 1=1`;
    const params = [];

    if (search) {
      sql += ` AND (s.full_name LIKE ? OR s.school LIKE ? OR s.school_city LIKE ? OR s.email LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (school)   { sql += ' AND s.school = ?';    params.push(school); }
    if (cls)      { sql += ' AND s.class = ?';     params.push(cls); }
    if (fit_tier) { sql += ' AND rs.fit_tier = ?'; params.push(fit_tier); }
    sql += ' ORDER BY s.registered_at DESC';

    res.json({ students: db.prepare(sql).all(...params) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Full student detail ───────────────────────────────────────────

app.get('/api/students/:sessionId', requireAuth, (req, res) => {
  try {
    const { sessionId } = req.params;

    // 1. Student — all 15 columns
    const student = db.prepare('SELECT * FROM students WHERE session_id = ?').get(sessionId);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    // 2. Report summary — all 29 columns
    const summary = db.prepare('SELECT * FROM report_summary WHERE session_id = ?').get(sessionId) ?? null;

    // 3. Raw assessment row (needed to enrich personality + interests + seaa)
    const asmtRow = db.prepare('SELECT * FROM assessments WHERE session_id = ?').get(sessionId) ?? null;

    // Parse each module JSON once
    const nmapJson = tryParse(asmtRow?.nmap_scores_json);
    const cpiJson  = tryParse(asmtRow?.cpi_scores_json);
    const seaJson  = tryParse(asmtRow?.sea_scores_json);

    // 4. Personality — fixed names + raw/pct/emoji/desc from NMAP JSON
    const personalityRows = db.prepare(
      `SELECT position, name, stanine, band FROM report_personality
       WHERE session_id = ? ORDER BY position`
    ).all(sessionId);

    const nmapByPos = {};
    (nmapJson?.dims ?? []).forEach((d, i) => {
      nmapByPos[i] = { raw: d.raw, pct: d.pct, emoji: d.emoji ?? null, desc: d.desc ?? null };
    });

    const personality = personalityRows.map(r => ({
      position: r.position,
      name:     traitName(r),
      stanine:  r.stanine,
      band:     r.band,
      raw:      nmapByPos[r.position]?.raw   ?? null,
      pct:      nmapByPos[r.position]?.pct   ?? null,
      emoji:    nmapByPos[r.position]?.emoji ?? null,
      desc:     nmapByPos[r.position]?.desc  ?? null,
    }));

    // Patch top_personality_traits_json in summary with corrected data
    if (summary) {
      summary.top_personality_traits_json = JSON.stringify(topTraits(personality));
    }

    // 5. Aptitude — all 8 columns (already correct in DB)
    const aptitude = db.prepare(
      `SELECT position, key, name, stanine, band, raw_score, max_score
       FROM report_aptitude WHERE session_id = ? ORDER BY position`
    ).all(sessionId);

    // 6. Interests — all ranks + pct/abbr/color from CPI JSON
    const interestRows = db.prepare(
      `SELECT rank, label, score, level FROM report_interests
       WHERE session_id = ? ORDER BY rank`
    ).all(sessionId);

    const cpiByLabel = {};
    (cpiJson?.areas ?? []).forEach(a => {
      cpiByLabel[a.label] = { pct: a.pct, abbr: a.abbr ?? null, color: a.color ?? null };
    });

    const interests = interestRows.map(r => ({
      rank:  r.rank,
      label: r.label,
      score: r.score,
      level: r.level,
      pct:   cpiByLabel[r.label]?.pct   ?? null,
      abbr:  cpiByLabel[r.label]?.abbr  ?? null,
      color: cpiByLabel[r.label]?.color ?? null,
    }));

    // 7. SEAA — all columns + detail_level from SEA JSON
    const seaaRows = db.prepare(
      `SELECT key, title, score, category, cat_label FROM report_seaa
       WHERE session_id = ? ORDER BY key`
    ).all(sessionId);

    const seaLevelByKey = {};
    Object.entries(seaJson?.cls ?? {}).forEach(([k, v]) => {
      seaLevelByKey[k] = v.level ?? null;
    });

    const seaa = seaaRows.map(r => ({
      key:            r.key,
      title:          r.title,
      domain:         r.title,      // alias: student-detail.js looks for s.domain
      score:          r.score,
      category:       r.category,
      cat_label:      r.cat_label,
      category_label: r.cat_label,  // alias: student-detail.js looks for s.category_label
      detail_level:   seaLevelByKey[r.key] ?? null,
    }));

    // 8. Careers — all 11 columns, aliased for both app.js and student-detail.js
    const careers = db.prepare(
      `SELECT
         position, career, career AS career_name,
         cluster, interest_fit, aptitude_fit, personality_fit, seaa_fit,
         suitability_pct, alignment, alignment AS fit_level, rationale
       FROM report_careers WHERE session_id = ? ORDER BY position`
    ).all(sessionId);

    // 9. Section progress — all 5 columns
    const sectionProgress = db.prepare(
      `SELECT id, module_key, submitted_at, duration_seconds
       FROM section_progress WHERE session_id = ? ORDER BY submitted_at`
    ).all(sessionId);

    // 10. Parsed module scores (full JSON contents, not just what report_* tables store)
    const modules = asmtRow ? {
      cpi:  cpiJson,
      sea:  seaJson,
      nmap: nmapJson,
      daab: {
        va:  tryParse(asmtRow.daab_va_scores_json),
        pa:  tryParse(asmtRow.daab_pa_scores_json),
        na:  tryParse(asmtRow.daab_na_scores_json),
        lsa: tryParse(asmtRow.daab_lsa_scores_json),
        hma: tryParse(asmtRow.daab_hma_scores_json),
        ar:  tryParse(asmtRow.daab_ar_scores_json),
        ma:  tryParse(asmtRow.daab_ma_scores_json),
        sa:  tryParse(asmtRow.daab_sa_scores_json),
      },
      timing: {
        saved_at:                  asmtRow.saved_at,
        cpi_completed_at:          asmtRow.cpi_completed_at,
        cpi_duration_seconds:      asmtRow.cpi_duration_seconds,
        sea_completed_at:          asmtRow.sea_completed_at,
        sea_duration_seconds:      asmtRow.sea_duration_seconds,
        nmap_completed_at:         asmtRow.nmap_completed_at,
        nmap_duration_seconds:     asmtRow.nmap_duration_seconds,
        daab_va_completed_at:      asmtRow.daab_va_completed_at,
        daab_va_duration_seconds:  asmtRow.daab_va_duration_seconds,
        daab_pa_completed_at:      asmtRow.daab_pa_completed_at,
        daab_pa_duration_seconds:  asmtRow.daab_pa_duration_seconds,
        daab_na_completed_at:      asmtRow.daab_na_completed_at,
        daab_na_duration_seconds:  asmtRow.daab_na_duration_seconds,
        daab_lsa_completed_at:     asmtRow.daab_lsa_completed_at,
        daab_lsa_duration_seconds: asmtRow.daab_lsa_duration_seconds,
        daab_hma_completed_at:     asmtRow.daab_hma_completed_at,
        daab_hma_duration_seconds: asmtRow.daab_hma_duration_seconds,
        daab_ar_completed_at:      asmtRow.daab_ar_completed_at,
        daab_ar_duration_seconds:  asmtRow.daab_ar_duration_seconds,
        daab_ma_completed_at:      asmtRow.daab_ma_completed_at,
        daab_ma_duration_seconds:  asmtRow.daab_ma_duration_seconds,
        daab_sa_completed_at:      asmtRow.daab_sa_completed_at,
        daab_sa_duration_seconds:  asmtRow.daab_sa_duration_seconds,
      },
    } : null;

    res.json({
      student,          // all 15 columns
      summary,          // all 29 columns; null if no report yet
      personality,      // 9 rows: corrected names + raw/pct/emoji/desc
      aptitude,         // 8 rows: all columns
      interests,        // all ranks + pct/abbr/color
      seaa,             // all rows + detail_level; aliased domain & category_label
      seaTotal: seaJson?.total ?? null,
      careers,          // all rows; aliased career_name & fit_level
      sectionProgress,
      modules,          // full parsed JSON for every assessment module
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Raw assessment data (for debugging / re-scoring) ─────────────

app.get('/api/students/:sessionId/raw', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM assessments WHERE session_id = ?').get(req.params.sessionId);
    if (!row) return res.status(404).json({ error: 'No assessment data found.' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NuMind MAPS  →  http://localhost:${PORT}`);
  console.log(`Database     →  ${DB_PATH}`);
});

module.exports = app;
