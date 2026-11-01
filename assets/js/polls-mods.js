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

  const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
  function scoreQ(q, given, correct) {
    if (correct === undefined || given === undefined) return null;
    if (q.type === 'minute') {
      const g = parseInt(given, 10), c = parseInt(correct, 10);
      if (g === c) return q.points;
      return q.near && Math.abs(g - c) <= q.near.within ? q.near.points : 0;
    }
    return norm(given) === norm(correct) ? q.points : 0;
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
      const key = (D.answers || {})[poll.id] || poll.answers || {};
      const scored = Object.keys(key).length > 0;
      const list = rows.map(r => {
        const cells = poll.questions.map(q => scoreQ(q, r.answers[q.id], key[q.id]));
        return {r, fl: flags(r.answers), cells, total: cells.reduce((s, c) => s + (c || 0), 0)};
      });
      if (scored) list.sort((x, y) => y.total - x.total || new Date(x.r.created_at) - new Date(y.r.created_at));
      const bad = list.filter(x => x.fl.length).length;
      const max = poll.questions.reduce((s, q) => s + q.points, 0);
      root.append(h('h2', {class: 'match-title'}, poll.match),
        h('p', {class: 'lead'}, rows.length + ' of ' + D.managers.length + ' in · ' + bad + ' flagged' + (scored ? ' · scored out of ' + max : '')));
      if (scored) {
        const top = list[0].total;
        const win = list.filter(x => x.total === top).map(x => (by[String(x.r.entry_id)] || {}).name);
        root.append(h('div', {class: 'pbanner good'}, '🏆 ' + (win.length > 1 ? 'Tied lead: ' : 'Leader: ') + win.join(', ') + ' · ' + top + ' pts'));
      }
      const head = h('tr', {}, h('th', {}, scored ? '#' : ''), h('th', {}, 'Manager'),
        ...poll.questions.map((q, i) => h('th', {title: q.text}, 'Q' + (i + 1))), scored ? h('th', {}, 'Pts') : '', h('th', {}, 'Locked in'), h('th', {}, 'Checks'));
      const keyRow = scored ? h('tr', {class: 'keyrow'}, h('td', {}), h('td', {}, 'Result'),
        ...poll.questions.map(q => h('td', {}, fmtAns(q, key[q.id]))), h('td', {}), h('td', {}), h('td', {})) : '';
      let rank = 0, prev = null;
      const table = h('table', {}, h('thead', {}, head),
        h('tbody', {}, keyRow, ...list.map((x, i) => {
          const mg = by[String(x.r.entry_id)] || {name: 'Unknown (' + x.r.entry_id + ')', team: ''};
          if (x.total !== prev) { rank = i + 1; prev = x.total; }
          return h('tr', {},
            h('td', {}, scored ? String(rank) : ''),
            h('td', {}, mg.name, h('div', {class: 'tm'}, mg.team)),
            ...poll.questions.map((q, qi) => h('td', {class: x.cells[qi] ? 'ok' : ''}, fmtAns(q, x.r.answers[q.id]) + (x.cells[qi] ? ' ✓' : ''))),
            scored ? h('td', {class: 'pts'}, String(x.total)) : '',
            h('td', {}, new Date(x.r.created_at).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})),
            h('td', {class: x.fl.length ? 'no' : 'ok', style: x.fl.length ? 'color:var(--warn);white-space:normal;min-width:200px' : ''}, x.fl.length ? '⚠ ' + x.fl.join('; ') : '✓'));
        })));
      root.append(h('div', {class: 'rgrid'}, table));
      const miss = D.managers.filter(x => !done.has(x.id));
      if (miss.length) root.append(h('p', {class: 'lead'}, 'Not in yet (' + miss.length + '): ' + miss.map(x => x.name).join(', ')));
    }
  }
  show();
})();
