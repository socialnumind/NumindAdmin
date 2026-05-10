'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();

// ── Lazy-load better-sqlite3 (read-only — cannot modify your data)
let _db = null;
function getDb() {
  if (_db) return _db;
  const Database = require('better-sqlite3');
  const dbPath   = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(process.cwd(), 'numind.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `[Admin] Database file not found: "${dbPath}"\n` +
      `  → Set SQLITE_PATH in your .env file to the correct path.`
    );
  }

  _db = new Database(dbPath, { readonly: true });
  _db.pragma('busy_timeout = 5000');
  console.log('[Admin] Connected (read-only) to DB:', dbPath);
  return _db;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/students
//   Returns list of all students with summary metrics.
//   Supports optional query params: ?search=&school=&class=&fit_tier=
// ─────────────────────────────────────────────────────────────────
router.get('/students', (req, res) => {
  try {
    const db = getDb();
    const { search, school, class: cls, fit_tier } = req.query;

    let sql = `
      SELECT
        s.session_id, s.full_name, s.first_name, s.last_name,
        s.class, s.section, s.school, s.school_city, s.school_state,
        s.age, s.gender, s.email,
        s.registered_at, s.completed_at, s.report_generated_at,
        r.fit_score, r.fit_tier,
        r.avg_personality_stanine, r.avg_aptitude_stanine,
        r.top_interest_score,
        r.personality_status, r.aptitude_status,
        r.interest_status, r.seaa_status,
        r.recommended_primary, r.recommended_alternate, r.recommended_exploratory,
        r.internal_motivators,
        r.is_fallback
      FROM students s
      LEFT JOIN report_summary r ON r.session_id = s.session_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (s.full_name LIKE ? OR s.email LIKE ? OR s.school LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (school)   { sql += ` AND s.school = ?`;   params.push(school); }
    if (cls)      { sql += ` AND s.class = ?`;    params.push(cls); }
    if (fit_tier) { sql += ` AND r.fit_tier = ?`; params.push(fit_tier); }

    sql += ` ORDER BY s.registered_at DESC`;

    const rows = db.prepare(sql).all(params);
    res.json({ students: rows });
  } catch (err) {
    console.error('[API /students]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/students/meta  ← MUST be before /:sessionId
//   Returns distinct schools, classes for filter dropdowns.
// ─────────────────────────────────────────────────────────────────
router.get('/students/meta', (req, res) => {
  try {
    const db      = getDb();
    const schools = db.prepare(`SELECT DISTINCT school FROM students WHERE school IS NOT NULL AND school != '' ORDER BY school`).all().map(r => r.school);
    const classes = db.prepare(`SELECT DISTINCT class  FROM students WHERE class  IS NOT NULL AND class  != '' ORDER BY class`).all().map(r => r.class);
    const total   = db.prepare(`SELECT COUNT(*) as n FROM students`).get().n;
    const withReport = db.prepare(`SELECT COUNT(*) as n FROM report_summary`).get().n;
    // Count placeholder/fallback reports separately so the admin knows how many are real
    const fallbackCount = db.prepare(`SELECT COUNT(*) as n FROM report_summary WHERE is_fallback = 1`).get().n;
    res.json({ schools, classes, total, withReport, fallbackCount });
  } catch (err) {
    console.error('[API /students/meta]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/students/:sessionId
//   Returns the full report for one student (all 7 tables).
// ─────────────────────────────────────────────────────────────────
router.get('/students/:sessionId', (req, res) => {
  try {
    const db        = getDb();
    const { sessionId } = req.params;

    const student     = db.prepare(`SELECT * FROM students          WHERE session_id = ?`).get(sessionId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const summary     = db.prepare(`SELECT * FROM report_summary    WHERE session_id = ?`).get(sessionId);
    const personality = db.prepare(`SELECT * FROM report_personality WHERE session_id = ? ORDER BY position`).all(sessionId);
    const aptitude    = db.prepare(`SELECT * FROM report_aptitude   WHERE session_id = ? ORDER BY position`).all(sessionId);
    const interests   = db.prepare(`SELECT * FROM report_interests  WHERE session_id = ? ORDER BY rank`).all(sessionId);
    const seaa        = db.prepare(`SELECT * FROM report_seaa       WHERE session_id = ?`).all(sessionId);
    // cluster and rationale are included via SELECT * — no change needed here
    const careers     = db.prepare(`SELECT * FROM report_careers    WHERE session_id = ? ORDER BY position`).all(sessionId);

    // Parse JSON string columns in summary
    if (summary) {
      const jsonCols = [
        'strong_fit_pathways', 'emerging_fit_pathways', 'exploratory_pathways',
        'top_personality_traits_json', 'strong_aptitudes_json',
        'emerging_aptitudes_json', 'top3_interests_json',
      ];
      jsonCols.forEach(col => {
        if (typeof summary[col] === 'string') {
          try { summary[col] = JSON.parse(summary[col]); } catch (_) {}
        }
      });
    }

    res.json({ student, summary, personality, aptitude, interests, seaa, careers });
  } catch (err) {
    console.error('[API /students/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/stats
//   Dashboard-level aggregate stats.
// ─────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const total    = db.prepare(`SELECT COUNT(*) as n FROM students`).get().n;
    const complete = db.prepare(`SELECT COUNT(*) as n FROM students WHERE completed_at IS NOT NULL`).get().n;
    const reports  = db.prepare(`SELECT COUNT(*) as n FROM report_summary`).get().n;
    // Surface fallback count at the stats level so the dashboard can warn admins
    const fallback = db.prepare(`SELECT COUNT(*) as n FROM report_summary WHERE is_fallback = 1`).get().n;
    const tiers    = db.prepare(`
      SELECT fit_tier, COUNT(*) as n FROM report_summary
      WHERE fit_tier IS NOT NULL GROUP BY fit_tier
    `).all();
    const recent   = db.prepare(`
      SELECT full_name, school, registered_at FROM students
      ORDER BY registered_at DESC LIMIT 5
    `).all();
    res.json({ total, complete, reports, fallback, tiers, recent });
  } catch (err) {
    console.error('[API /stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
