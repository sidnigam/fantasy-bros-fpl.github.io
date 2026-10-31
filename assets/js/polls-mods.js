(function () {
  const D = JSON.parse(document.getElementById('poll-data').textContent);
  const root = document.getElementById('mods-root');
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    kids.flat().forEach(c => el.append(c instanceof Node ? c : document.createTextNode(c)));
    return el;
  };
  const SB = D.supabase;
  let key = null;
  try { key = sessionStorage.getItem('mods-key'); } catch (e) {}
  const m = location.hash.match(/k=([^&]+)/);
  if (m) { key = decodeURIComponent(m[1]); try { sessionStorage.setItem('mods-key', key); } catch (e) {} history.replaceState(null, '', location.pathname); }

  // Impossible combinations only (home = first team in the score). Soft flags: mods decide.
  function flags(a) {
    const out = [];
    const sc = /^(\d+)-(\d+)$/.exec(a.q2 || '');
    if (!sc) return out;
    const hg = +sc[1], ag = +sc[2], tot = hg + ag;
    if (a.q1) { const exp = hg > ag ? 'win' : hg < ag ? 'win' : 'Draw';
      const ok = hg === ag ? a.q1 === 'Draw' : (hg > ag ? /^Liverpool/.test(a.q1) : /^Arsenal/.test(a.q1));
      if (!ok) out.push('Result (Q1) contradicts score'); }
    if (a.q3) { const ok = tot === 0 ? /^Neither/.test(a.q3) : /^Neither/.test(a.q3) ? false : a.q3 === 'Liverpool' ? hg > 0 : ag > 0;
      if (!ok) out.push('First scorer (Q3) impossible for score'); }
    if (a.q4 !== undefined && (a.q4 === 0) !== (tot === 0)) out.push('First-goal minute (Q4) vs score');
    if (a.q5) { const exp = tot === 0 ? 'Both (0-0)' : ag === 0 ? 'Liverpool' : hg === 0 ? 'Arsenal' : 'Neither';
      if (a.q5 !== exp) out.push('Clean sheet (Q5) contradicts score'); }
    if (a.q6) { const exp = tot <= 1 ? '0-1' : tot === 2 ? '2' : tot === 3 ? '3' : '4+';
      if (a.q6 !== exp) out.push('Total goals (Q6) contradicts score'); }
    if (a.q8 && (tot === 0) !== (a.q8 === 'Same number of goals') && tot <= 1) out.push('Half with more goals (Q8) vs score');
    return out;
  }

  async function fetchRows(poll) {
    const r = await fetch(SB.url + '/rest/v1/rpc/poll_admin_responses', {method: 'POST',
      headers: {apikey: SB.anon_key, Authorization: 'Bearer ' + SB.anon_key, 'Content-Type': 'application/json'},
      body: JSON.stringify({p: poll.id, k: key})});
    const j = await r.json();
    if (!r.ok) throw new Error(/forbidden/.test(JSON.stringify(j)) ? 'forbidden' : (j.message || r.status));
    return j;
  }

  const fmtAns = (q, v) => v === undefined ? '–' : q.type === 'minute' ? v + "'" : String(v);

  async function show() {
    root.replaceChildren();
    if (!SB || !SB.url) { root.append(h('div', {class: 'pbanner warn'}, 'Database not configured.')); return; }
    if (!key) {
      const inp = h('input', {type: 'password', placeholder: 'Mods key', style: 'max-width:320px'});
      root.append(h('div', {class: 'who'}, h('label', {}, 'Enter the mods key'), inp,
        h('p', {}, h('button', {class: 'linkbtn', onclick: () => { key = inp.value.trim(); try { sessionStorage.setItem('mods-key', key); } catch (e) {} show(); }}, 'Open'))));
      return;
    }
    for (const poll of D.polls) {
      let rows;
      try { rows = await fetchRows(poll); }
      catch (e) {
        if (e.message === 'forbidden') { try { sessionStorage.removeItem('mods-key'); } catch (x) {} key = null; root.append(h('div', {class: 'pbanner warn'}, 'Wrong key.')); setTimeout(show, 1200); }
        else root.append(h('div', {class: 'pbanner warn'}, 'Could not load: ' + e.message));
        return;
      }
      const by = Object.fromEntries(D.managers.map(x => [x.id, x]));
      const done = new Set(rows.map(r => String(r.entry_id)));
      const bad = rows.filter(r => flags(r.answers).length).length;
      root.append(h('h2', {class: 'match-title'}, poll.match),
        h('p', {class: 'lead'}, rows.length + ' of ' + D.managers.length + ' in · pot $' + rows.length * D.stake + ' · ' + bad + ' flagged'));
      const table = h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Locked in'), h('th', {}, 'Manager'), ...poll.questions.map((q, i) => h('th', {title: q.text}, 'Q' + (i + 1))), h('th', {}, 'Checks'))),
        h('tbody', {}, ...rows.map(r => {
          const mg = by[String(r.entry_id)] || {name: 'Unknown (' + r.entry_id + ')', team: ''};
          const fl = flags(r.answers);
          return h('tr', {},
            h('td', {}, new Date(r.created_at).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})),
            h('td', {}, mg.name, h('div', {class: 'tm'}, mg.team)),
            ...poll.questions.map(q => h('td', {}, fmtAns(q, r.answers[q.id]))),
            h('td', {class: fl.length ? 'no' : 'ok', style: fl.length ? 'color:var(--warn);white-space:normal;min-width:200px' : ''}, fl.length ? '⚠ ' + fl.join('; ') : '✓'));
        })));
      root.append(h('div', {class: 'rgrid'}, table));
      const miss = D.managers.filter(x => !done.has(x.id));
      if (miss.length) root.append(h('p', {class: 'lead'}, 'Not in yet (' + miss.length + '): ' + miss.map(x => x.name).join(', ')));
    }
  }
  show();
})();
