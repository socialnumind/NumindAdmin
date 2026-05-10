/**
 * student-detail.js
 * -----------------
 * Renders a full student detail panel from the /api/students/:sessionId
 * response, surfacing every field that was previously missing from the
 * dashboard UI:
 *
 *   ✔  is_fallback             — warning banner when report is a placeholder
 *   ✔  recommended_primary /
 *      recommended_alternate /
 *      recommended_exploratory — pathway boxes (Page 10)
 *   ✔  top_personality_traits_json — Top 3 dominant traits (Page 4)
 *   ✔  strong_aptitudes_json /
 *      emerging_aptitudes_json    — aptitude tags (Page 5)
 *   ✔  top3_interests_json        — interest cluster summary (Page 6)
 *   ✔  internal_motivators        — "What Drives You" prose (Page 6)
 *   ✔  career.cluster             — groups career matrix rows
 *   ✔  career.rationale           — shown as tooltip / expand row
 *
 * Usage
 * -----
 *   import { renderStudentDetail } from './student-detail.js';
 *
 *   // When a row is clicked and you fetch /api/students/:sessionId:
 *   const data = await fetch(`/api/students/${sessionId}`).then(r => r.json());
 *   renderStudentDetail(data, document.getElementById('detail-panel'));
 *
 * The function writes into `containerEl` — no external CSS framework
 * required. Add student-detail.css (or inline the styles below) for
 * polished rendering.
 */

'use strict';

/**
 * Main entry point.
 * @param {Object} data        - Response from GET /api/students/:sessionId
 * @param {HTMLElement} containerEl - Element to render into (cleared first)
 */
export function renderStudentDetail(data, containerEl) {
  if (!containerEl) return;
  const { student, summary, personality, aptitude, interests, seaa, careers } = data;

  containerEl.innerHTML = '';

  // ── Fallback / placeholder warning ─────────────────────────────
  if (summary && summary.is_fallback) {
    containerEl.appendChild(el('div', { class: 'sd-banner sd-banner--warn' },
      '⚠ This report was generated as a placeholder. The student has not completed the full assessment.'
    ));
  }

  // ── Header ──────────────────────────────────────────────────────
  containerEl.appendChild(buildHeader(student, summary));

  // ── Pathway boxes (previously not rendered) ─────────────────────
  if (summary) {
    containerEl.appendChild(buildPathways(summary));
  }

  // ── Top 3 Personality Traits (previously not rendered) ──────────
  if (summary && summary.top_personality_traits_json) {
    containerEl.appendChild(buildPersonalityTraits(summary.top_personality_traits_json));
  } else if (personality && personality.length) {
    // Fallback: derive top 3 from the personality rows directly
    const top3 = personality.slice().sort((a, b) => b.stanine - a.stanine).slice(0, 3);
    containerEl.appendChild(buildPersonalityTraits(top3.map(p => ({
      name:    p.trait_name || p.name || p.label || '—',
      stanine: p.stanine,
    }))));
  }

  // ── Aptitude tags (previously not rendered) ─────────────────────
  if (summary && (summary.strong_aptitudes_json || summary.emerging_aptitudes_json)) {
    containerEl.appendChild(buildAptitudeTags(summary));
  }

  // ── Top 3 Interests (previously not rendered) ───────────────────
  if (summary && summary.top3_interests_json) {
    containerEl.appendChild(buildInterests(summary.top3_interests_json));
  }

  // ── Internal Motivators / "What Drives You" (previously not rendered)
  if (summary && summary.internal_motivators) {
    containerEl.appendChild(buildMotivators(summary.internal_motivators));
  }

  // ── Career matrix with cluster grouping + rationale tooltip
  //    (cluster and rationale were queried but never shown) ─────────
  if (careers && careers.length) {
    containerEl.appendChild(buildCareerMatrix(careers));
  }

  // ── SEAA scores ─────────────────────────────────────────────────
  if (seaa && seaa.length) {
    containerEl.appendChild(buildSeaa(seaa));
  }
}

// ─────────────────────────────────────────────────────────────────
// Section builders
// ─────────────────────────────────────────────────────────────────

function buildHeader(student, summary) {
  const fitTier  = summary ? (summary.fit_tier  || '—') : '—';
  const fitScore = summary ? (summary.fit_score != null ? summary.fit_score + ' / 100' : '—') : '—';

  const header = el('div', { class: 'sd-header' });
  header.appendChild(el('h2',  { class: 'sd-name'  }, safe(student.full_name)));
  header.appendChild(el('p',   { class: 'sd-meta'  },
    [student.class, student.section].filter(Boolean).join(' ') +
    (student.school ? ` · ${student.school}` : '') +
    (student.school_city ? `, ${student.school_city}` : '')
  ));

  const scoreRow = el('div', { class: 'sd-score-row' });
  scoreRow.appendChild(badge('Fit Score', fitScore, 'purple'));
  scoreRow.appendChild(badge('Fit Tier',  fitTier,  tierColor(fitTier)));
  if (summary) {
    if (summary.personality_status) scoreRow.appendChild(badge('Personality', summary.personality_status, statusColor(summary.personality_status)));
    if (summary.aptitude_status)    scoreRow.appendChild(badge('Aptitude',    summary.aptitude_status,    statusColor(summary.aptitude_status)));
    if (summary.interest_status)    scoreRow.appendChild(badge('Interest',    summary.interest_status,    statusColor(summary.interest_status)));
    if (summary.seaa_status)        scoreRow.appendChild(badge('SEAA',        summary.seaa_status,        statusColor(summary.seaa_status)));
  }
  header.appendChild(scoreRow);
  return header;
}

/** Pathway boxes — recommended_primary / alternate / exploratory */
function buildPathways(summary) {
  const section = sectionWrap('Recommended Pathways');

  const pathways = [
    { label: 'Primary',      value: summary.recommended_primary,      color: 'purple' },
    { label: 'Alternate',    value: summary.recommended_alternate,     color: 'teal'   },
    { label: 'Exploratory',  value: summary.recommended_exploratory,   color: 'gray'   },
  ];

  const row = el('div', { class: 'sd-pathway-row' });
  pathways.forEach(({ label, value, color }) => {
    if (!value) return;
    const box = el('div', { class: `sd-pathway-box sd-pathway-box--${color}` });
    box.appendChild(el('span', { class: 'sd-pathway-label' }, label));
    box.appendChild(el('span', { class: 'sd-pathway-value' }, value));
    row.appendChild(box);
  });
  section.appendChild(row);
  return section;
}

/** Top 3 dominant personality traits */
function buildPersonalityTraits(traits) {
  const section = sectionWrap('Top 3 Dominant Personality Traits');
  const row = el('div', { class: 'sd-trait-row' });

  (Array.isArray(traits) ? traits : []).slice(0, 3).forEach((t, i) => {
    const name    = t.name || t.trait_name || t.label || '—';
    const stanine = t.stanine != null ? `${t.stanine} / 9` : '';
    const card = el('div', { class: 'sd-trait-card' });
    card.appendChild(el('span', { class: 'sd-trait-rank' }, `0${i + 1}`));
    card.appendChild(el('span', { class: 'sd-trait-name' }, name));
    if (stanine) card.appendChild(el('span', { class: 'sd-trait-score' }, stanine));
    row.appendChild(card);
  });
  section.appendChild(row);
  return section;
}

/** Strong + emerging aptitude tag clouds */
function buildAptitudeTags(summary) {
  const section = sectionWrap('Aptitude Highlights');

  const renderGroup = (title, items, colorClass) => {
    if (!items || !items.length) return;
    const group = el('div', { class: 'sd-tag-group' });
    group.appendChild(el('h4', { class: 'sd-tag-group-title' }, title));
    const tags = el('div', { class: 'sd-tags' });
    items.forEach(name => {
      tags.appendChild(el('span', { class: `sd-tag sd-tag--${colorClass}` }, name));
    });
    group.appendChild(tags);
    section.appendChild(group);
  };

  renderGroup('Strong Aptitude Areas',   toArray(summary.strong_aptitudes_json),   'strong');
  renderGroup('Emerging Aptitude Areas', toArray(summary.emerging_aptitudes_json), 'emerging');
  return section;
}

/** Top 3 interest clusters */
function buildInterests(top3) {
  const section = sectionWrap('Top 3 Career Interests');
  const items = toArray(top3);
  const row = el('div', { class: 'sd-interest-row' });

  items.slice(0, 3).forEach((item, i) => {
    const label = item.label || item.name || item || '—';
    const score = item.score != null ? `${item.score} / 20` : '';
    const card = el('div', { class: 'sd-interest-card' });
    card.appendChild(el('span', { class: 'sd-interest-rank' }, `0${i + 1}`));
    card.appendChild(el('span', { class: 'sd-interest-label' }, label));
    if (score) card.appendChild(el('span', { class: 'sd-interest-score' }, score));
    row.appendChild(card);
  });
  section.appendChild(row);
  return section;
}

/** Internal motivators prose block ("What Drives You") */
function buildMotivators(text) {
  const section = sectionWrap('What Drives You');
  const prose = el('p', { class: 'sd-prose' }, text);
  section.appendChild(prose);
  return section;
}

/**
 * Career matrix — grouped by cluster, with rationale exposed
 * as an expandable row (click the career name to toggle rationale).
 */
function buildCareerMatrix(careers) {
  const section = sectionWrap('Career Alignment Matrix');

  // Group by cluster; rows without a cluster fall under "General"
  const groups = {};
  careers.forEach(c => {
    const cluster = c.cluster || 'General';
    if (!groups[cluster]) groups[cluster] = [];
    groups[cluster].push(c);
  });

  const table = el('table', { class: 'sd-career-table' });
  const thead = el('thead');
  const headerRow = el('tr');
  ['Career', 'Cluster', 'Fit', 'Rationale'].forEach(h => {
    headerRow.appendChild(el('th', {}, h));
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = el('tbody');

  Object.entries(groups).forEach(([cluster, rows]) => {
    // Cluster group header row
    const groupRow = el('tr', { class: 'sd-career-cluster-row' });
    const groupCell = el('td', { colspan: '4', class: 'sd-career-cluster-label' }, cluster);
    groupRow.appendChild(groupCell);
    tbody.appendChild(groupRow);

    rows.forEach(c => {
      const careerName = c.career_name || c.career || c.name || c.label || '—';
      const fitLevel   = c.fit_level   || c.alignment || c.fit || '—';
      const rationale  = c.rationale   || '';
      const is_fallback_row = c.is_fallback;

      const tr = el('tr', { class: 'sd-career-row' + (is_fallback_row ? ' sd-career-row--fallback' : '') });

      // Career name cell — clicking expands rationale inline
      const nameTd = el('td', { class: 'sd-career-name' });
      const nameBtn = el('button', { class: 'sd-career-toggle', title: rationale ? 'Click to see rationale' : '' }, careerName);
      nameTd.appendChild(nameBtn);

      // Rationale expand row (hidden by default)
      let rationaleRow = null;
      if (rationale) {
        nameBtn.classList.add('sd-career-toggle--expandable');
        rationaleRow = el('tr', { class: 'sd-career-rationale-row sd-career-rationale-row--hidden' });
        const rationaleCell = el('td', { colspan: '4', class: 'sd-career-rationale' }, rationale);
        rationaleRow.appendChild(rationaleCell);

        nameBtn.addEventListener('click', () => {
          const hidden = rationaleRow.classList.toggle('sd-career-rationale-row--hidden');
          nameBtn.classList.toggle('sd-career-toggle--open', !hidden);
        });
      }

      tr.appendChild(nameTd);
      tr.appendChild(el('td', { class: 'sd-career-cluster' }, cluster));
      tr.appendChild(el('td', { class: `sd-career-fit sd-career-fit--${fitClass(fitLevel)}` }, fitLevel));
      tr.appendChild(el('td', { class: 'sd-career-rationale-hint' }, rationale ? '▸ expand' : '—'));

      tbody.appendChild(tr);
      if (rationaleRow) tbody.appendChild(rationaleRow);
    });
  });

  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

/** SEAA domain cards */
function buildSeaa(seaa) {
  const section = sectionWrap('SEAA Readiness');
  const row = el('div', { class: 'sd-seaa-row' });
  seaa.forEach(s => {
    const card = el('div', { class: `sd-seaa-card sd-seaa-card--${seaaColor(s.category || s.cat)}` });
    card.appendChild(el('span', { class: 'sd-seaa-domain' },  s.domain || s.title || '—'));
    card.appendChild(el('span', { class: 'sd-seaa-score'  },  s.score  != null ? `${s.score} / 20` : '—'));
    card.appendChild(el('span', { class: 'sd-seaa-status' },  s.category_label || s.cat || s.category || '—'));
    row.appendChild(card);
  });
  section.appendChild(row);
  return section;
}

// ─────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────

/** Create an element with optional attributes and text content. */
function el(tag, attrs, textOrChildren) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
  }
  if (typeof textOrChildren === 'string') {
    node.textContent = textOrChildren;
  } else if (Array.isArray(textOrChildren)) {
    textOrChildren.forEach(c => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  }
  return node;
}

function sectionWrap(title) {
  const section = el('div', { class: 'sd-section' });
  section.appendChild(el('h3', { class: 'sd-section-title' }, title));
  return section;
}

function badge(label, value, color) {
  const b = el('div', { class: `sd-badge sd-badge--${color}` });
  b.appendChild(el('span', { class: 'sd-badge-label' }, label));
  b.appendChild(el('span', { class: 'sd-badge-value' }, value));
  return b;
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

const safe = (v) => (v == null ? '—' : String(v));

/** Parse a value that may already be an array or a JSON string. */
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) {}
  }
  return [];
}

function tierColor(tier) {
  if (!tier) return 'gray';
  const t = tier.toLowerCase();
  if (t.includes('strong'))      return 'purple';
  if (t.includes('emerging'))    return 'teal';
  if (t.includes('exploratory')) return 'gray';
  return 'gray';
}

function statusColor(status) {
  if (!status) return 'gray';
  const s = status.toLowerCase();
  if (s.includes('strength') || s.includes('strong')) return 'green';
  if (s.includes('developing'))                        return 'teal';
  if (s.includes('support'))                           return 'red';
  return 'gray';
}

function fitClass(fit) {
  if (!fit) return 'none';
  const f = fit.toLowerCase();
  if (f.includes('strong'))   return 'strong';
  if (f.includes('moderate')) return 'moderate';
  if (f.includes('low'))      return 'low';
  return 'none';
}

function seaaColor(cat) {
  if (!cat) return 'gray';
  const c = String(cat).toUpperCase();
  if (c === 'A' || c === 'B') return 'green';
  if (c === 'C')               return 'amber';
  return 'red';
}
