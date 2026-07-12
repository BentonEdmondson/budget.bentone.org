'use strict';
/* budget.bentone.org — a fully client-side monthly budget.
   No dependencies. No network use. Compatible with CSP: default-src 'self'
   (no inline scripts/styles/handlers; all styling via classes + CSSOM). */

/* ================= Pure helpers (also unit-testable in Node) ================= */

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTH_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

function pad2(n){ return String(n).padStart(2, '0'); }

function toCents(v){
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100);
  if (typeof v === 'string'){
    const s = v.replace(/[$,\s]/g, '');
    if (s === '' || isNaN(Number(s))) return null;
    return Math.round(Number(s) * 100);
  }
  return null;
}

function fmtMoney(cents){
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = pad2(abs % 100);
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + rest;
}

function daysInMonth(y, m){ return new Date(y, m, 0).getDate(); } // m: 1-12
function validDate(y, m, d){
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
function isoKey(dt){ return dt.y + '-' + pad2(dt.m) + '-' + pad2(dt.d); }
function dayNumber(dt){ return Date.UTC(dt.y, dt.m - 1, dt.d) / 86400000; }
function fmtBudgetDate(dt){ return dt.d + ' ' + MONTHS[dt.m - 1] + ' ' + dt.y; }

function monthIndex(mstr){
  const i = MONTH_RE.split('|').indexOf(mstr.slice(0, 3).toLowerCase());
  return i >= 0 ? i + 1 : null;
}
function expandYear(y){ return y < 100 ? 2000 + y : y; }

/* Parse a date string in any of several common formats. Returns {y,m,d} or null. */
function parseDateFlexible(s){
  if (typeof s !== 'string') return null;
  const str = s.trim();
  let m;
  // ISO: 2026-06-30
  if ((m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){
    const dt = { y: +m[1], m: +m[2], d: +m[3] };
    return validDate(dt.y, dt.m, dt.d) ? dt : null;
  }
  // "5 June 2026" / "5 Jun 26"
  const reDMY = new RegExp('^(\\d{1,2})\\s+(' + MONTH_RE + ')[a-z]*\\.?\\s+(\\d{2,4})$', 'i');
  if ((m = str.match(reDMY))){
    const dt = { y: expandYear(+m[3]), m: monthIndex(m[2]), d: +m[1] };
    return validDate(dt.y, dt.m, dt.d) ? dt : null;
  }
  // "June 5, 2026"
  const reMDY = new RegExp('^(' + MONTH_RE + ')[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})$', 'i');
  if ((m = str.match(reMDY))){
    const dt = { y: expandYear(+m[3]), m: monthIndex(m[1]), d: +m[2] };
    return validDate(dt.y, dt.m, dt.d) ? dt : null;
  }
  // Numeric: 06/30/2026 (month-first), 30/06/2026 fallback, 2026/06/30
  if ((m = str.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/))){
    const a = +m[1], b = +m[2], c = +m[3];
    const tries = a >= 1000
      ? [{ y: a, m: b, d: c }]
      : [{ y: expandYear(c), m: a, d: b }, { y: expandYear(c), m: b, d: a }, { y: expandYear(a), m: b, d: c }];
    for (const t of tries) if (validDate(t.y, t.m, t.d)) return t;
  }
  return null;
}

/* Extract the most plausible date mentioned inside a free-text description.
   `processed` (a {y,m,d}) anchors year inference and scoring. */
function extractDescDate(desc, processed){
  if (typeof desc !== 'string' || !desc) return null;
  const cands = [];
  const push = (y, mth, d) => { if (validDate(y, mth, d)) cands.push({ y, m: mth, d }); };
  let work = desc;

  // ISO anywhere
  work = work.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_, y, mo, d) => { push(+y, +mo, +d); return ' '; });

  // Textual: "30 June 2026", "June 30, 26", "Jun 30" (year optional)
  const reA = new RegExp('\\b(\\d{1,2})\\s*(' + MONTH_RE + ')[a-z]*\\.?\\s*,?\\s*(\\d{2,4})?\\b', 'gi');
  const reB = new RegExp('\\b(' + MONTH_RE + ')[a-z]*\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{2,4})?\\b', 'gi');
  const textual = (re, dayIdx, monIdx) => {
    work = work.replace(re, (...args) => {
      const g = args;
      const d = +g[dayIdx], mo = monthIndex(g[monIdx]);
      if (g[3]) push(expandYear(+g[3]), mo, d);
      else if (processed){ // infer year nearest to processed date
        for (const y of [processed.y, processed.y - 1, processed.y + 1]) push(y, mo, d);
      }
      return ' ';
    });
  };
  textual(reA, 1, 2);
  textual(reB, 2, 1);

  // Numeric triples: 06/30/26, 26/06/29, 2026-06-29, 30.06.2026 …
  work = work.replace(/\b(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})\b/g, (_, sa, sb, sc) => {
    const a = +sa, b = +sb, c = +sc;
    if (sa.length === 4){ push(a, b, c); }                    // YYYY/MM/DD
    else if (sc.length === 4){ push(c, a, b); push(c, b, a); }// MM/DD/YYYY, DD/MM/YYYY
    else { push(expandYear(c), a, b); push(expandYear(c), b, a); push(expandYear(a), b, c); }
    return ' ';
  });

  // Numeric pairs with no year: "06/30" — infer year from the processed date.
  work.replace(/\b(\d{1,2})[\/.](\d{1,2})\b/g, (_, sa, sb) => {
    const a = +sa, b = +sb;
    const years = processed ? [processed.y, processed.y - 1] : [new Date().getFullYear()];
    for (const y of years){ push(y, a, b); push(y, b, a); }
    return ' ';
  });

  if (!cands.length) return null;
  if (!processed) return cands[0];

  // Score: closest to the processed date wins; dates after processing are
  // penalized (a bank processes a purchase after it happens, not before).
  const pDay = dayNumber(processed);
  let best = null, bestScore = Infinity;
  for (const c of cands){
    const diff = dayNumber(c) - pDay;
    if (diff > 5 || diff < -370) continue;
    const score = Math.abs(diff) + (diff > 0 ? 30 : 0);
    if (score < bestScore){ bestScore = score; best = c; }
  }
  return best;
}

/* RFC-4180-ish CSV parser: quoted fields, embedded commas/quotes/newlines. */
function parseCSV(text){
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQ){
      if (c === '"'){ if (text[i + 1] === '"'){ field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ','){ row.push(field); field = ''; }
    else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

/* -------- Limits: validation and implied-limit computation -------- */

function tagIsValid(tag){
  if (tag === '.') return true;
  if (typeof tag !== 'string' || tag === '') return false;
  return tag.split('.').every(seg => seg.trim() !== '');
}
function ancestorsOf(tag){
  if (tag === '.' || tag === '') return [];
  const segs = tag.split('.');
  const out = [];
  for (let i = segs.length - 1; i >= 1; i--) out.push(segs.slice(0, i).join('.'));
  out.push('.');
  return out;
}

/* Coherence: a tag's limit may never exceed the limit of any of its
   ancestors — the ancestor already caps it. Returns a list of error strings. */
function validateLimits(limits){
  const errors = [];
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits))
    return ['The "limits" section must be an object of tag → amount.'];
  for (const [tag, val] of Object.entries(limits)){
    if (!tagIsValid(tag)) errors.push(`"${tag}" is not a valid tag name.`);
    if (typeof val !== 'number' || !isFinite(val) || val < 0)
      errors.push(`The limit for "${tag}" must be a non-negative number.`);
  }
  if (errors.length) return errors;
  for (const [tag, val] of Object.entries(limits)){
    for (const anc of ancestorsOf(tag)){
      if (anc in limits && val > limits[anc] + 1e-9){
        errors.push(`Incoherent limits: "${tag}" (${fmtMoney(toCents(val))}) exceeds its ancestor "${anc}" (${fmtMoney(toCents(limits[anc]))}), which already caps it.`);
      }
    }
  }
  return errors;
}

/* Build the full tag tree. Nodes come from explicit limits, from transaction
   tags, and from implied ancestors. Implied (omitted) tags get an automatic
   limit equal to the sum of their children's limits — used in the app only,
   never written back to the JSON. */
function buildTree(limits, transactions, y, m){
  const nodes = new Map(); // tag -> node
  const ensure = (tag) => {
    if (nodes.has(tag)) return nodes.get(tag);
    const node = { tag, name: tag === '.' ? 'Total budget' : (tag === '' ? 'Untagged' : tag.split('.').pop()),
      children: [], explicit: null, implied: null, direct: 0, spent: 0 };
    nodes.set(tag, node);
    if (tag !== '.'){
      const parentTag = (tag === '' || !tag.includes('.')) ? '.' : tag.slice(0, tag.lastIndexOf('.'));
      const parent = ensure(parentTag);
      parent.children.push(node);
    }
    return node;
  };
  ensure('.');
  for (const tag of Object.keys(limits)){ if (tagIsValid(tag)) ensure(tag).explicit = toCents(limits[tag]); }
  ensure('.').explicit = ('.' in limits) ? toCents(limits['.']) : null;

  for (const tx of transactions){
    const dt = parseDateFlexible(tx.date);
    tx._parsed = dt;
    const inMonth = dt && dt.y === y && dt.m === m;
    const tag = tagIsValid(tx.tag) && tx.tag !== '.' ? tx.tag : '';
    const node = ensure(tag === '.' ? '' : tag);
    if (inMonth) node.direct += toCents(tx.amount) || 0;
  }

  // Post-order: spent = direct + children; implied limit = sum of children's limits.
  const finish = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    let spent = node.direct, childLimits = 0, anyChildLimit = false;
    for (const c of node.children){
      finish(c);
      spent += c.spent;
      const cl = c.explicit != null ? c.explicit : c.implied;
      if (cl != null){ childLimits += cl; anyChildLimit = true; }
    }
    node.spent = spent;
    node.implied = (node.explicit == null && anyChildLimit) ? childLimits : null;
  };
  finish(nodes.get('.'));
  return nodes.get('.');
}

/* Compare budget transactions to statement rows by (date, amount) pairs,
   counting duplicates. Returns rows/txs on each side that lack a partner. */
function compareTx(budgetTx, stmtRows){
  const bByKey = new Map(), sByKey = new Map();
  for (const t of budgetTx){
    const k = isoKey(t.date) + '|' + t.cents;
    (bByKey.get(k) || bByKey.set(k, []).get(k)).push(t);
  }
  for (const r of stmtRows){
    const k = isoKey(r.effDate) + '|' + r.cents;
    (sByKey.get(k) || sByKey.set(k, []).get(k)).push(r);
  }
  const missingFromBudget = [], missingFromStatement = [];
  for (const [k, rows] of sByKey){
    const have = (bByKey.get(k) || []).length;
    if (rows.length > have) missingFromBudget.push(...rows.slice(have));
  }
  for (const [k, txs] of bByKey){
    const have = (sByKey.get(k) || []).length;
    if (txs.length > have) missingFromStatement.push(...txs.slice(have));
  }
  const byDate = (a, b) => a._sort - b._sort;
  missingFromBudget.forEach(r => r._sort = dayNumber(r.effDate));
  missingFromStatement.forEach(t => t._sort = dayNumber(t.date));
  missingFromBudget.sort(byDate); missingFromStatement.sort(byDate);
  return { missingFromBudget, missingFromStatement };
}

/* Parse an imported bank statement CSV into normalized rows. */
function parseStatement(text){
  const rows = parseCSV(text);
  if (!rows.length) return { error: 'The statement file appears to be empty.' };
  const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const header = rows[0].map(norm);
  const col = (...names) => { for (const n of names){ const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const iDate = col('processeddate', 'date', 'postdate', 'posteddate');
  const iDesc = col('description', 'memo', 'details');
  const iType = col('creditordebit', 'type', 'transactiontype');
  const iAmt  = col('amount');
  if (iDate < 0 || iAmt < 0)
    return { error: 'Could not find the "Processed Date" and "Amount" columns in the statement.' };

  const out = [], problems = [];
  let credits = 0;
  rows.slice(1).forEach((r, idx) => {
    const typeVal = iType >= 0 ? String(r[iType] || '').trim().toLowerCase() : 'debit';
    if (typeVal.startsWith('credit')){ credits++; return; } // credits are ignored
    const processed = parseDateFlexible(r[iDate]);
    const cents = toCents(r[iAmt]);
    if (!processed || cents == null){ problems.push(idx + 2); return; }
    const description = iDesc >= 0 ? String(r[iDesc] || '').trim() : '';
    const descDate = extractDescDate(description, processed);
    const differs = descDate && isoKey(descDate) !== isoKey(processed);
    out.push({
      id: idx, processed, descDate: differs ? descDate : null,
      useDescDate: !!differs,           // prefer the description's date when it differs
      description, cents: Math.abs(cents)
    });
  });
  return { rows: out, credits, problems };
}

/* ================= Application state & DOM ================= */

const state = {
  budget: null,          // { limits: {tag: number}, transactions: [{date, amount, description, tag}] }
  fileName: 'budget.json',
  month: null,           // { y, m }
  statement: null,       // { rows, credits, problems }
  editingTx: -1,
  editingField: null,
  addingChildOf: null,
  editingLimitOf: null
};

let savedSnapshot = null;
function snapshotBudget(){
  if (!state.budget) return;
  savedSnapshot = JSON.stringify({ limits: state.budget.limits, transactions: state.budget.transactions });
}
function isBudgetDirty(){
  if (!state.budget || savedSnapshot == null) return false;
  return JSON.stringify({ limits: state.budget.limits, transactions: state.budget.transactions }) !== savedSnapshot;
}

function $(id){ return document.getElementById(id); }

function showAlert(kind, text){
  const box = document.createElement('div');
  box.className = 'alert ' + kind;
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'alert-close'; close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => box.remove());
  box.append(span, close);
  $('alerts').append(box);
  if (kind === 'ok') setTimeout(() => box.remove(), 6000);
}
function clearAlerts(){ $('alerts').textContent = ''; }

function currentMonth(){ const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 }; }

/* Fraction of the selected month already elapsed (null → month not started). */
function monthElapsedFraction(){
  const now = new Date();
  const cur = { y: now.getFullYear(), m: now.getMonth() + 1 };
  const sel = state.month;
  if (sel.y < cur.y || (sel.y === cur.y && sel.m < cur.m)) return 1;
  if (sel.y === cur.y && sel.m === cur.m) return now.getDate() / daysInMonth(sel.y, sel.m);
  return null;
}

/* ---------------- Budget tree rendering ---------------- */

function renderTree(){
  const root = buildTree(state.budget.limits, state.budget.transactions, state.month.y, state.month.m);
  const frac = monthElapsedFraction();
  const container = $('tree');
  container.textContent = '';
  const note = $('paceNote');
  if (frac === null) note.textContent = `${MONTHS[state.month.m - 1]} ${state.month.y} hasn't started yet, so no pace projection is shown.`;
  else if (frac === 1) note.textContent = `${MONTHS[state.month.m - 1]} ${state.month.y} is complete; totals are final.`;
  else note.textContent = `${Math.round(frac * 100)}% of ${MONTHS[state.month.m - 1]} has elapsed. The tick marks where you should be at this point.`;
  renderNode(root, container, 0, frac);
}

function renderNode(node, container, depth, frac){
  const row = document.createElement('div');
  row.className = 'node';

  const limit = node.explicit != null ? node.explicit : node.implied;
  const projected = (frac && frac > 0 && limit != null) ? Math.round(limit * frac) : null;
  const over = limit != null && node.spent > limit;
  const overPace = !over && limit != null && projected != null && node.spent > projected;

  // Name + leader line
  const nameWrap = document.createElement('div');
  nameWrap.className = 'node-name';
  nameWrap.style.paddingLeft = (depth * 22) + 'px';
  const nm = document.createElement('span');
  nm.className = node.tag === '.' ? 'nm root' : 'nm';
  nm.textContent = node.tag === '.' ? 'Total budget (income)' : node.name;
  nameWrap.append(nm);
  if (node.explicit == null && node.implied != null){
    const chip = document.createElement('span');
    chip.className = 'chip auto';
    chip.title = 'Limit computed automatically from sub-tags; not stored in your file.';
    chip.textContent = 'auto';
    nameWrap.append(chip);
  }
  const leader = document.createElement('span');
  leader.className = 'leader';
  nameWrap.append(leader);

  // Figures
  const figures = document.createElement('div');
  figures.className = 'node-figures';
  const spentEl = document.createElement('span');
  spentEl.className = 'num spent' + (over ? ' over' : '');
  spentEl.textContent = fmtMoney(node.spent);
  figures.append(spentEl);
  const limEl = document.createElement('span');
  limEl.className = 'num limit';
  limEl.textContent = limit != null ? ' / ' + fmtMoney(limit) : ' / —';
  figures.append(limEl);

  // Bar with pace tick
  const barWrap = document.createElement('div');
  barWrap.className = 'bar';
  if (limit != null && limit > 0){
    const fill = document.createElement('div');
    fill.className = 'bar-fill ' + (over ? 'c-over' : overPace ? 'c-warn' : 'c-ok');
    fill.style.width = Math.min(100, (node.spent / limit) * 100) + '%';
    barWrap.append(fill);
    if (projected != null){
      const tick = document.createElement('div');
      tick.className = 'bar-tick ' + (projected > limit ? 'c-over' : 'c-ok');
      tick.style.left = Math.min(100, (projected / limit) * 100) + '%';
      tick.title = 'Where you should be at this point: ' + fmtMoney(projected);
      barWrap.append(tick);
    }
  } else {
    barWrap.classList.add('bar-none');
  }

  // Status chip
  const status = document.createElement('span');
  if (limit == null){ status.className = 'chip quiet'; status.textContent = 'no limit'; }
  else if (over){ status.className = 'chip bad'; status.textContent = 'over by ' + fmtMoney(node.spent - limit); }
  else if (overPace){ status.className = 'chip warnc'; status.textContent = 'ahead of pace by ' + fmtMoney(node.spent - projected); }
  else if (projected != null){ status.className = 'chip good'; status.textContent = 'on track · ' + fmtMoney(limit - node.spent) + ' left'; }
  else { status.className = 'chip good'; status.textContent = fmtMoney(limit - node.spent) + ' left'; }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'node-actions';
  const mkBtn = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mini'; b.textContent = label; b.title = title;
    b.addEventListener('click', fn); actions.append(b);
  };
  if (node.tag !== ''){
    mkBtn('limit', node.explicit != null ? 'Edit this limit' : 'Set an explicit limit', () => { state.editingLimitOf = node.tag; state.addingChildOf = null; render(); });
    mkBtn('+ sub-tag', 'Add a sub-tag with its own limit', () => { state.addingChildOf = node.tag; state.editingLimitOf = null; render(); });
    if (node.explicit != null && node.tag !== '.')
      mkBtn('clear', 'Remove this explicit limit', () => {
        delete state.budget.limits[node.tag];
        render();
      });
  }

  row.append(nameWrap, figures, barWrap, status, actions);
  container.append(row);

  if (state.editingLimitOf === node.tag) container.append(limitEditor(node, depth));
  if (state.addingChildOf === node.tag) container.append(childAdder(node, depth));

  for (const c of node.children) renderNode(c, container, depth + 1, frac);
}

function inlineForm(depth){
  const f = document.createElement('div');
  f.className = 'inline-form';
  f.style.marginLeft = (depth * 22) + 'px';
  return f;
}

function limitEditor(node, depth){
  const f = inlineForm(depth);
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.step = '0.01';
  input.value = node.explicit != null ? (node.explicit / 100).toFixed(2) : '';
  input.setAttribute('aria-label', 'Limit for ' + node.tag);
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'primary'; save.textContent = 'Save limit';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'Cancel';
  const apply = () => {
    const val = Number(input.value);
    if (!isFinite(val) || val < 0){ showAlert('err', 'The limit must be a non-negative number.'); return; }
    const next = Object.assign({}, state.budget.limits, { [node.tag]: Math.round(val * 100) / 100 });
    const errs = validateLimits(next);
    if (errs.length){ errs.forEach(e => showAlert('err', e)); return; }
    state.budget.limits = next;
    state.editingLimitOf = null;
    render();
  };
  save.addEventListener('click', apply);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
  cancel.addEventListener('click', () => { state.editingLimitOf = null; render(); });
  f.append(input, save, cancel);
  setTimeout(() => input.focus(), 0);
  return f;
}

function childAdder(node, depth){
  const f = inlineForm(depth + 1);
  const name = document.createElement('input');
  name.type = 'text'; name.placeholder = 'sub-tag name'; name.setAttribute('aria-label', 'New sub-tag name');
  const amt = document.createElement('input');
  amt.type = 'number'; amt.min = '0'; amt.step = '0.01'; amt.placeholder = 'limit';
  amt.setAttribute('aria-label', 'New sub-tag limit');
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'primary'; save.textContent = 'Add sub-tag';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'Cancel';
  const apply = () => {
    const seg = name.value.trim();
    if (!seg || seg.includes('.')){ showAlert('err', 'Enter a sub-tag name without dots (dots separate levels).'); return; }
    const tag = node.tag === '.' ? seg : node.tag + '.' + seg;
    const val = Number(amt.value);
    if (!isFinite(val) || val < 0){ showAlert('err', 'The limit must be a non-negative number.'); return; }
    const next = Object.assign({}, state.budget.limits, { [tag]: Math.round(val * 100) / 100 });
    const errs = validateLimits(next);
    if (errs.length){ errs.forEach(e => showAlert('err', e)); return; }
    state.budget.limits = next;
    state.addingChildOf = null;
    render();
  };
  save.addEventListener('click', apply);
  cancel.addEventListener('click', () => { state.addingChildOf = null; render(); });
  f.append(name, amt, save, cancel);
  setTimeout(() => name.focus(), 0);
  return f;
}

/* ---------------- Transactions rendering ---------------- */

function knownTags(){
  const s = new Set(Object.keys(state.budget.limits).filter(t => t !== '.'));
  for (const t of state.budget.transactions) if (t.tag) s.add(t.tag);
  return [...s].sort();
}

function renderTransactions(){
  const body = $('txBody');
  body.textContent = '';
  const txs = state.budget.transactions
    .map((tx, i) => ({ tx, i, dt: parseDateFlexible(tx.date) }))
    .sort((a, b) => (b.dt ? dayNumber(b.dt) : -Infinity) - (a.dt ? dayNumber(a.dt) : -Infinity));

  let inMonthCount = 0;
  for (const { tx, i, dt } of txs){
    const inMonth = dt && dt.y === state.month.y && dt.m === state.month.m;
    if (inMonth) inMonthCount++;
    body.append(state.editingTx === i ? txEditRow(tx, i) : txRow(tx, i, dt, inMonth));
  }
  $('txCount').textContent = `${state.budget.transactions.length} total · ${inMonthCount} in ${MONTHS[state.month.m - 1]} ${state.month.y}`;
}

function txRow(tx, i, dt, inMonth){
  const tr = document.createElement('tr');
  if (!inMonth) tr.className = 'dim';
  const tdDate = document.createElement('td');
  tdDate.textContent = tx.date;
  tdDate.addEventListener('dblclick', () => { state.editingTx = i; state.editingField = 'date'; render(); });
  if (!dt){
    const warn = document.createElement('span');
    warn.className = 'chip bad'; warn.textContent = 'unreadable date';
    warn.title = 'This date could not be parsed, so the transaction is excluded from monthly totals.';
    tdDate.append(' ', warn);
  }
  const tdDesc = document.createElement('td'); tdDesc.textContent = tx.description || '';
  tdDesc.addEventListener('dblclick', () => { state.editingTx = i; state.editingField = 'desc'; render(); });
  const tdTag = document.createElement('td');
  const tagChip = document.createElement('span');
  tagChip.className = 'chip tag'; tagChip.textContent = tx.tag || 'untagged';
  tdTag.append(tagChip);
  tdTag.addEventListener('dblclick', () => { state.editingTx = i; state.editingField = 'tag'; render(); });
  const tdAmt = document.createElement('td'); tdAmt.className = 'num';
  tdAmt.textContent = fmtMoney(toCents(tx.amount) || 0);
  tdAmt.addEventListener('dblclick', () => { state.editingTx = i; state.editingField = 'amount'; render(); });
  const tdAct = document.createElement('td'); tdAct.className = 'row-actions';
  const edit = document.createElement('button');
  edit.type = 'button'; edit.className = 'mini'; edit.textContent = 'edit';
  edit.addEventListener('click', () => { state.editingTx = i; state.editingField = null; render(); });
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'mini danger'; del.textContent = 'delete';
  del.addEventListener('click', () => { state.budget.transactions.splice(i, 1); state.editingTx = -1; render(); });
  tdAct.append(edit, del);
  tr.append(tdDate, tdDesc, tdTag, tdAmt, tdAct);
  return tr;
}

function txEditRow(tx, i){
  const tr = document.createElement('tr');
  tr.className = 'editing';
  const dt = parseDateFlexible(tx.date);
  const tdDate = document.createElement('td');
  const inDate = document.createElement('input');
  inDate.type = 'date';
  if (dt) inDate.value = isoKey(dt);
  tdDate.append(inDate);
  const tdDesc = document.createElement('td');
  const inDesc = document.createElement('input');
  inDesc.type = 'text'; inDesc.value = tx.description || '';
  tdDesc.append(inDesc);
  const tdTag = document.createElement('td');
  const inTag = document.createElement('input');
  inTag.type = 'text'; inTag.value = tx.tag || '';
  tdTag.append(inTag);
  const tdAmt = document.createElement('td');
  const inAmt = document.createElement('input');
  inAmt.type = 'number'; inAmt.min = '0.01'; inAmt.step = '0.01';
  inAmt.value = (toCents(tx.amount) / 100).toFixed(2);
  tdAmt.append(inAmt);
  const tdAct = document.createElement('td'); tdAct.className = 'row-actions';
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'mini primary'; save.textContent = 'save';
  const apply = () => {
    const d = parseDateFlexible(inDate.value);
    const cents = toCents(inAmt.value);
    const tag = inTag.value.trim().replace(/^\.+|\.+$/g, '');
    if (!d){ showAlert('err', 'Pick a valid date.'); return; }
    if (cents == null || cents <= 0){ showAlert('err', 'The amount must be a positive number — the budget records spending only.'); return; }
    if (tag && !tagIsValid(tag)){ showAlert('err', `"${tag}" is not a valid tag.`); return; }
    Object.assign(tx, { date: fmtBudgetDate(d), amount: cents / 100, description: inDesc.value.trim(), tag });
    state.editingTx = -1;
    render();
  };
  save.addEventListener('click', apply);
  for (const inp of [inDate, inDesc, inTag, inAmt])
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') apply(); });
  tr.addEventListener('focusout', () => {
    setTimeout(() => { if (!tr.contains(document.activeElement) && state.editingTx === i) apply(); }, 0);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'mini'; cancel.textContent = 'cancel';
  cancel.addEventListener('click', () => { state.editingTx = -1; render(); });
  tdAct.append(save, cancel);
  tr.append(tdDate, tdDesc, tdTag, tdAmt, tdAct);
  setTimeout(() => {
    const field = state.editingField;
    state.editingField = null;
    const el = field === 'date' ? inDate : field === 'tag' ? inTag : field === 'amount' ? inAmt : inDesc;
    el.focus(); el.select();
  }, 0);
  return tr;
}

function addTransactionFromForm(){
  const d = parseDateFlexible($('addDate').value);
  const cents = toCents($('addAmount').value);
  const tag = $('addTag').value.trim().replace(/^\.+|\.+$/g, '');
  if (!d){ showAlert('err', 'Pick a date for the new transaction.'); return; }
  if (cents == null || cents <= 0){ showAlert('err', 'The amount must be a positive number — the budget records spending only.'); return; }
  if (tag && !tagIsValid(tag)){ showAlert('err', `"${tag}" is not a valid tag.`); return; }
  state.budget.transactions.push({ date: fmtBudgetDate(d), amount: cents / 100, description: $('addDesc').value.trim(), tag });
  $('addDesc').value = ''; $('addTag').value = ''; $('addAmount').value = '';
  render();
}

/* ---------------- Reconciliation rendering ---------------- */

function reconInputs(){
  const { y, m } = state.month;
  const stmtInMonth = state.statement.rows.filter(r => {
    r.effDate = r.useDescDate && r.descDate ? r.descDate : r.processed;
    return r.effDate.y === y && r.effDate.m === m;
  });
  const budgetInMonth = [];
  state.budget.transactions.forEach((tx, i) => {
    const dt = parseDateFlexible(tx.date);
    if (dt && dt.y === y && dt.m === m)
      budgetInMonth.push({ i, tx, date: dt, cents: toCents(tx.amount) || 0 });
  });
  return { stmtInMonth, budgetInMonth };
}

function renderRecon(){
  const sec = $('reconSection');
  if (!state.statement || !state.budget){ sec.hidden = true; return; }
  sec.hidden = false;
  const { stmtInMonth, budgetInMonth } = reconInputs();
  const { missingFromBudget, missingFromStatement } = compareTx(budgetInMonth, stmtInMonth);
  const outOfMonth = state.statement.rows.length - stmtInMonth.length;

  const bits = [`${stmtInMonth.length} statement debit${stmtInMonth.length === 1 ? '' : 's'} in ${MONTHS[state.month.m - 1]} ${state.month.y}`];
  if (state.statement.credits) bits.push(`${state.statement.credits} credit${state.statement.credits === 1 ? '' : 's'} ignored`);
  if (outOfMonth) bits.push(`${outOfMonth} debit${outOfMonth === 1 ? '' : 's'} outside this month skipped`);
  if (state.statement.problems.length) bits.push(`${state.statement.problems.length} unreadable row${state.statement.problems.length === 1 ? '' : 's'} skipped (lines ${state.statement.problems.join(', ')})`);
  bits.push('Matching compares date and amount only.');
  $('reconSummary').textContent = bits.join(' · ');

  const listA = $('missingFromBudget');
  listA.textContent = '';
  $('btnAddAllMissing').hidden = missingFromBudget.length < 2;
  $('btnAddAllMissing').onclick = () => { missingFromBudget.forEach(importStatementRow); render(); };
  if (!missingFromBudget.length) listA.append(emptyLi('Every statement debit this month is already in your budget.'));
  for (const r of missingFromBudget){
    const li = document.createElement('li');
    const line = document.createElement('div');
    line.className = 'recon-line';
    const date = document.createElement('span');
    date.className = 'num'; date.textContent = fmtBudgetDate(r.effDate);
    const amt = document.createElement('span');
    amt.className = 'num strong'; amt.textContent = fmtMoney(r.cents);
    const desc = document.createElement('span');
    desc.className = 'recon-desc'; desc.textContent = r.description || '(no description)';
    line.append(date, amt, desc);
    li.append(line);
    if (r.descDate){
      const src = document.createElement('div');
      src.className = 'date-src';
      const chip = document.createElement('span');
      chip.className = 'chip ' + (r.useDescDate ? 'warnc' : 'quiet');
      chip.textContent = r.useDescDate ? 'date read from description' : 'using processed date';
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'mini';
      toggle.textContent = r.useDescDate
        ? 'revert to processed date (' + fmtBudgetDate(r.processed) + ')'
        : 'use description date (' + fmtBudgetDate(r.descDate) + ')';
      toggle.addEventListener('click', () => { r.useDescDate = !r.useDescDate; render(); });
      src.append(chip, toggle);
      li.append(src);
    }
    const act = document.createElement('div');
    act.className = 'recon-act';
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'mini primary'; add.textContent = 'Add to budget';
    add.addEventListener('click', () => { importStatementRow(r); render(); });
    act.append(add);
    li.append(act);
    listA.append(li);
  }

  const listB = $('missingFromStatement');
  listB.textContent = '';
  if (!missingFromStatement.length) listB.append(emptyLi('Every budget transaction this month appears in the statement.'));
  for (const t of missingFromStatement){
    const li = document.createElement('li');
    const line = document.createElement('div');
    line.className = 'recon-line';
    const date = document.createElement('span');
    date.className = 'num'; date.textContent = fmtBudgetDate(t.date);
    const amt = document.createElement('span');
    amt.className = 'num strong'; amt.textContent = fmtMoney(t.cents);
    const desc = document.createElement('span');
    desc.className = 'recon-desc';
    desc.textContent = (t.tx.description || '(no description)') + (t.tx.tag ? ' · ' + t.tx.tag : '');
    line.append(date, amt, desc);
    const act = document.createElement('div');
    act.className = 'recon-act';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'mini danger'; rm.textContent = 'Remove from budget';
    rm.addEventListener('click', () => {
      state.budget.transactions.splice(t.i, 1);
      state.editingTx = -1;
      render();
    });
    act.append(rm);
    li.append(line, act);
    listB.append(li);
  }
}

function emptyLi(text){
  const li = document.createElement('li');
  li.className = 'empty'; li.textContent = '✓ ' + text;
  return li;
}

function importStatementRow(r){
  state.budget.transactions.push({
    date: fmtBudgetDate(r.effDate),
    amount: r.cents / 100,
    description: r.description,
    tag: ''
  });
}

/* ---------------- Loading, saving, wiring ---------------- */

function normalizeBudget(obj){
  const errors = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
    return { errors: ['The budget file must contain a JSON object.'] };
  const limits = obj.limits == null ? {} : obj.limits;
  errors.push(...validateLimits(limits));
  const txsIn = obj.transactions == null ? [] : obj.transactions;
  if (!Array.isArray(txsIn)) errors.push('The "transactions" section must be an array.');
  const transactions = [];
  if (Array.isArray(txsIn)) txsIn.forEach((t, i) => {
    if (typeof t !== 'object' || t === null){ errors.push(`Transaction #${i + 1} is not an object.`); return; }
    const cents = toCents(t.amount);
    if (cents == null || cents < 0) errors.push(`Transaction #${i + 1}: the amount must be a non-negative number (income is never recorded as a transaction).`);
    if (typeof t.date !== 'string' || !parseDateFlexible(t.date)) errors.push(`Transaction #${i + 1}: unreadable date "${t.date}".`);
    const tag = typeof t.tag === 'string' ? t.tag : '';
    if (tag && tag !== '.' && !tagIsValid(tag)) errors.push(`Transaction #${i + 1}: invalid tag "${tag}".`);
    transactions.push({ date: String(t.date), amount: (cents || 0) / 100, description: typeof t.description === 'string' ? t.description : '', tag: tag === '.' ? '' : tag });
  });
  if (errors.length) return { errors };
  return { budget: { limits: Object.assign({}, limits), transactions } };
}

function loadBudgetFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    clearAlerts();
    let obj;
    try { obj = JSON.parse(reader.result); }
    catch (e){ showAlert('err', 'That file is not valid JSON: ' + e.message); return; }
    const { budget, errors } = normalizeBudget(obj);
    if (errors){ errors.forEach(e => showAlert('err', e)); showAlert('err', 'The budget was not loaded. Fix the file and try again.'); return; }
    state.budget = budget;
    state.fileName = file.name || 'budget.json';
    state.statement = null; state.editingTx = -1; state.addingChildOf = null; state.editingLimitOf = null;
    snapshotBudget();
    showAlert('ok', `Loaded "${state.fileName}" — ${budget.transactions.length} transactions, ${Object.keys(budget.limits).length} limits.`);
    render();
  };
  reader.onerror = () => showAlert('err', 'Could not read that file.');
  reader.readAsText(file);
}

function loadStatementFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    clearAlerts();
    const result = parseStatement(reader.result);
    if (result.error){ showAlert('err', result.error); return; }
    state.statement = result;
    showAlert('ok', `Statement loaded: ${result.rows.length} debits found.`);
    render();
  };
  reader.onerror = () => showAlert('err', 'Could not read that file.');
  reader.readAsText(file);
}

function saveBudget(){
  const out = {
    limits: state.budget.limits, // explicit limits only; automatic ones are never written
    transactions: state.budget.transactions.map(t => ({
      date: t.date, amount: Math.round(t.amount * 100) / 100,
      description: t.description, tag: t.tag
    }))
  };
  const blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  snapshotBudget();
  showAlert('ok', `Saved ${state.fileName} to your downloads.`);
}

function render(){
  const has = !!state.budget;
  $('emptyState').hidden = has;
  $('treeSection').hidden = !has;
  $('txSection').hidden = !has;
  $('btnSave').disabled = !has;
  $('btnLoadStatement').disabled = !has;
  if (has){ renderTree(); renderTransactions(); }
  renderRecon();
}

function init(){
  const now = currentMonth();
  state.month = now;
  $('monthInput').value = now.y + '-' + pad2(now.m);
  $('monthInput').addEventListener('change', () => {
    const v = $('monthInput').value;
    const m = v.match(/^(\d{4})-(\d{2})$/);
    if (m){ state.month = { y: +m[1], m: +m[2] }; render(); }
  });
  $('btnLoadBudget').addEventListener('click', () => $('budgetFile').click());
  $('btnEmptyOpen').addEventListener('click', () => $('budgetFile').click());
  $('budgetFile').addEventListener('change', e => { if (e.target.files[0]) loadBudgetFile(e.target.files[0]); e.target.value = ''; });
  $('btnLoadStatement').addEventListener('click', () => $('statementFile').click());
  $('statementFile').addEventListener('change', e => { if (e.target.files[0]) loadStatementFile(e.target.files[0]); e.target.value = ''; });
  $('btnSave').addEventListener('click', saveBudget);
  const newBudget = () => {
    state.budget = { limits: { '.': 0 }, transactions: [] };
    state.fileName = 'budget.json';
    state.statement = null; state.editingTx = -1;
    clearAlerts();
    snapshotBudget();
    showAlert('ok', 'New budget created. Set your monthly income on the "Total budget" row, then add tags.');
    render();
  };
  $('btnNew').addEventListener('click', newBudget);
  $('btnEmptyNew').addEventListener('click', newBudget);
  $('btnAddTx').addEventListener('click', addTransactionFromForm);
  for (const id of ['addDate', 'addDesc', 'addTag', 'addAmount'])
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') addTransactionFromForm(); });
  $('btnCloseRecon').addEventListener('click', () => { state.statement = null; render(); });
  window.addEventListener('beforeunload', e => { if (isBudgetDirty()){ e.preventDefault(); e.returnValue = ''; } });
  $('addDate').value = isoKey({ y: now.y, m: now.m, d: new Date().getDate() });
  render();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined'){
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
}
if (typeof module === 'object' && module && module.exports){
  module.exports = { parseCSV, parseDateFlexible, extractDescDate, validateLimits,
    buildTree, compareTx, parseStatement, toCents, fmtMoney, fmtBudgetDate, isoKey };
}
