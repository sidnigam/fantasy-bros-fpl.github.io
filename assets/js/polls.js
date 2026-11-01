(function () {
  const D = JSON.parse(document.getElementById('poll-data').textContent);
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => el.append(c instanceof Node ? c : document.createTextNode(c)));
    return el;
  };
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const poll = D.poll;
  let tab = location.hash === '#responses' ? 'responses' : 'predict';
  let me = null;                // chosen manager
  let draft = {};
  let submitted = new Set();    // entry ids locked in on the server
  let results = [];             // all responses (server only returns these after kickoff)
  let serverErr = null;
  let busy = false;
  let reviewing = false;
  // which team (if any) an option's text is about -> its colour
  const teamColor = txt => {
    const t = Object.keys(poll.teams || {}).find(n => new RegExp('\\b' + n + '\\b', 'i').test(txt) && !/^(neither|both|tie)/i.test(txt));
    return t ? poll.teams[t] : null;
  };
  let closesAt = null;          // set from the server's poll_meta
  const isClosed = () => !!closesAt && new Date() >= closesAt;
  const revealed = () => !!closesAt && isClosed();

  const myKey = () => 'poll-me';
  const draftKey = () => 'poll-draft-' + poll.id + '-' + (me ? me.id : '');
  const keyKey = () => 'poll-key-' + poll.id;

  // ------------------------------------------------------------- server (Supabase REST)
  const SB = D.supabase && D.supabase.url && D.supabase.anon_key ? D.supabase : null;
  const sb = (path, opts) => fetch(SB.url + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign({apikey: SB.anon_key, Authorization: 'Bearer ' + SB.anon_key, 'Content-Type': 'application/json'}, (opts || {}).headers)}));

  async function load() {
    if (!SB) return render();
    serverErr = null;
    try {
      const id = encodeURIComponent(poll.id);
      const [meta, subs, rows] = await Promise.all([
        sb('poll_meta?poll_id=eq.' + id + '&select=closes_at').then(r => r.json()),
        sb('rpc/poll_submitters', {method: 'POST', body: JSON.stringify({p: poll.id})}).then(r => r.json()),
        sb('poll_responses?poll_id=eq.' + id + '&select=entry_id,answers').then(r => r.json()),
      ]);
      if (!Array.isArray(subs) || !Array.isArray(rows)) throw new Error('bad response');
      closesAt = meta[0] ? new Date(meta[0].closes_at) : null;
      submitted = new Set(subs.map(x => String(x.entry_id)));
      results = rows.map(r => {
        const m = D.managers.find(x => x.id === String(r.entry_id));
        return m ? {entry_id: m.id, name: m.name, team: m.team, answers: r.answers} : null;
      }).filter(Boolean);
    } catch (e) { serverErr = 'Could not reach the poll server. Try refreshing.'; }
    render();
  }

  async function lockIn(btn) {
    if (busy) return; busy = true; btn.disabled = true; btn.textContent = 'Locking in…';
    try {
      const r = await sb('poll_responses', {method: 'POST', headers: {Prefer: 'return=minimal'},
        body: JSON.stringify({poll_id: poll.id, entry_id: me.id, answers: draft})});
      if (r.status === 409) { submitted.add(me.id); }       // already locked in (e.g. from another device)
      else if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'Failed (' + r.status + ')');
      submitted.add(me.id); reviewing = false; ls.set(draftKey(), null);
    } catch (e) {
      alert('Could not lock in: ' + e.message + '\nYour picks are saved on this device, please try again.');
    }
    busy = false; await load(); window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------- helpers
  const answered = q => draft[q.id] !== undefined && draft[q.id] !== '' && !(q.type === 'score' && !/^\d+-\d+$/.test(draft[q.id]));
  const hasSubmitted = m => submitted.has(m.id);

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function scoreQ(q, given, correct) {
    if (correct === undefined || correct === '' || given === undefined) return null;
    if (q.type === 'minute') {
      const g = parseInt(given, 10), c = parseInt(correct, 10);
      if (g === c) return q.points;
      if (q.near && Math.abs(g - c) <= q.near.within) return q.near.points;
      return 0;
    }
    return norm(given) === norm(correct) ? q.points : 0;
  }
  const keyAnswers = () => Object.assign({}, poll.answers || {}, ls.get(keyKey()) || {});

  // ------------------------------------------------------------- predict view
  function nameCard() {
    const box = h('div', {class: 'who'});
    if (me) {
      box.append(h('label', {}, 'Playing as'),
        h('div', {class: 'chosen'},
          h('span', {}, me.name, ' ', h('small', {}, me.team)),
          h('button', {class: 'linkbtn', onclick: () => { me = null; ls.set(myKey(), null); render(); }}, 'Change')));
      return box;
    }
    const input = h('input', {type: 'text', placeholder: 'Type your name or team name…', autocomplete: 'off'});
    const list = h('div', {class: 'suggest'});
    const fill = () => {
      const q = norm(input.value);
      list.replaceChildren(...D.managers
        .filter(m => !q || norm(m.name).includes(q) || norm(m.team).includes(q))
        .map(m => h('button', {class: hasSubmitted(m) ? 'done' : '', onclick: () => {
          me = m; ls.set(myKey(), m.id); draft = ls.get(draftKey()) || {}; render();
        }}, m.name, h('small', {}, m.team + (hasSubmitted(m) ? ' · locked in' : '')))));
    };
    input.addEventListener('input', fill); fill();
    box.append(h('label', {}, 'Who are you?'), input, list);
    return box;
  }

  function questionCard(q, i) {
    const card = h('div', {class: 'qcard' + (answered(q) ? ' answered' : '')},
      h('div', {class: 'qn'}, h('span', {}, 'Question ' + (i + 1) + ' of ' + poll.questions.length),
        h('span', {}, q.points + (q.points === 1 ? ' pt' : ' pts'))),
      h('h3', {}, q.text));
    if (q.hint) card.append(h('div', {class: 'hint'}, q.hint));
    const tint = v => {
      const c = typeof v === 'string' ? teamColor(v) : null;
      if (c) card.style.setProperty('--tc', c); else card.style.removeProperty('--tc');
      card.classList.toggle('tinted', !!c);
    };
    if (q.type === 'choice') setTimeout(() => tint(draft[q.id]));
    const set = v => { draft[q.id] = v; if (me) ls.set(draftKey(), draft); updateSubmit(); card.classList.toggle('answered', answered(q)); };

    if (q.type === 'choice') {
      const wrap = h('div', {class: 'opts'});
      q.options.forEach(o => {
        const b = h('button', {class: 'opt', type: 'button', 'aria-pressed': draft[q.id] === o ? 'true' : 'false', onclick: () => {
          wrap.querySelectorAll('.opt').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true'); set(o); tint(o);
        }}, o);
        const c = teamColor(o); if (c) b.style.setProperty('--tc', c);
        wrap.append(b);
      });
      card.append(wrap);
    } else if (q.type === 'score') {
      const [a0, b0] = (draft[q.id] || '').split('-');
      const a = h('input', {type: 'number', inputmode: 'numeric', min: 0, max: 20, value: a0 || '', placeholder: '0'});
      const b = h('input', {type: 'number', inputmode: 'numeric', min: 0, max: 20, value: b0 || '', placeholder: '0'});
      const upd = () => { if (a.value !== '' && b.value !== '') set(parseInt(a.value, 10) + '-' + parseInt(b.value, 10)); else { delete draft[q.id]; set(undefined); delete draft[q.id]; } };
      a.addEventListener('input', upd); b.addEventListener('input', upd);
      card.append(h('div', {class: 'scorein'},
        h('div', {}, h('label', {}, poll.home), a), h('span', {class: 'dash'}, '–'), h('div', {}, h('label', {}, poll.away), b)));
    } else if (q.type === 'minute') {
      const out = h('div', {class: 'minute-out'});
      const show = () => { out.textContent = draft[q.id] === undefined ? 'Slide to pick' : (draft[q.id] === 0 ? 'No goals (0)' : draft[q.id] + "'"); };
      const inp = h('input', {type: 'range', class: 'slider', min: 0, max: 90, step: 1, value: draft[q.id] ?? 0});
      inp.addEventListener('input', () => { set(parseInt(inp.value, 10)); show(); });
      inp.addEventListener('change', () => { set(parseInt(inp.value, 10)); show(); });
      show();
      card.append(out, inp, h('div', {class: 'slider-ends'}, h('span', {}, '0 (no goals)'), h('span', {}, '45'), h('span', {}, '90')));
    }
    return card;
  }

  const fmt = (q, v) => q.type === 'minute' ? (v === 0 ? '0 (no goals)' : v + "'") : (q.type === 'score' ? poll.home + ' ' + v.replace('-', ' – ') + ' ' + poll.away : String(v));
  function reviewCard() {
    const box = h('div', {class: 'qcard'}, h('h3', {}, 'Check your picks'),
      h('p', {class: 'hint'}, 'Once you lock in, they can\'t be changed.'));
    poll.questions.forEach((q, i) => {
      const c = q.type === 'choice' ? teamColor(draft[q.id]) : null;
      const row = h('div', {class: 'rev-row'}, h('div', {class: 'rev-q'}, (i + 1) + '. ' + q.text), h('div', {class: 'rev-a'}, fmt(q, draft[q.id])));
      if (c) row.style.setProperty('--tc', c), row.classList.add('tinted');
      box.append(row);
    });
    box.append(h('div', {class: 'submitbar'},
      h('button', {type: 'button', onclick: e => lockIn(e.target)}, '🔒 Lock in my picks'),
      h('p', {class: 'hint', style: 'text-align:center'}, h('button', {class: 'linkbtn', onclick: () => { reviewing = false; render(); }}, '← Back to edit'))));
    return box;
  }

  function lockedCard() {
    const mine = results.find(r => r.entry_id === me.id);
    const box = h('div', {class: 'qcard answered'}, h('h3', {}, '🔒 Picks locked in'),
      h('p', {}, 'You\'re in, ' + me.name + '. Picks stay hidden until kickoff; check the Responses tab after the game.'));
    if (mine) poll.questions.forEach((q, i) => box.append(h('div', {class: 'rev-row'}, h('div', {class: 'rev-q'}, (i + 1) + '. ' + q.text), h('div', {class: 'rev-a'}, fmt(q, mine.answers[q.id])))));
    return box;
  }

  let submitBtn = null;
  function updateSubmit() {
    if (!submitBtn) return;
    const left = poll.questions.filter(q => !answered(q)).length;
    submitBtn.disabled = !me || left > 0 || isClosed() || !SB;
    submitBtn.textContent = !me ? 'Pick your name first' : left ? left + ' question' + (left > 1 ? 's' : '') + ' left' : 'Review my picks';
  }

  function renderPredict(root) {
    root.append(h('h2', {class: 'match-title'}, '🔴 ' + poll.title + ': ' + poll.match), nameCard());
    if (isClosed()) { root.append(h('div', {class: 'pbanner warn'}, 'This poll is closed. Check the Responses tab.')); return; }
    if (!me) return;
    if (submitted.has(me.id)) { root.append(lockedCard()); return; }
    if (reviewing) { root.append(reviewCard()); return; }
    poll.questions.forEach((q, i) => root.append(questionCard(q, i)));
    submitBtn = h('button', {type: 'button', onclick: () => { reviewing = true; render(); window.scrollTo(0, 0); }});
    root.append(h('div', {class: 'submitbar'}, submitBtn));
    updateSubmit();
  }

  // ------------------------------------------------------------- responses view
  function renderResponses(root) {
    root.append(h('h2', {class: 'match-title'}, poll.match + ' · responses'));
    const resp = results;
    const n = revealed() ? resp.length : submitted.size;
    root.append(h('p', {class: 'lead'}, n + ' of ' + D.managers.length + ' managers in'));

    if (!revealed()) {
      root.append(h('div', {class: 'pbanner'}, '🔒 Picks stay hidden until kickoff (' + (closesAt ? closesAt.toLocaleString() : 'TBC') + '). Here is who is in:'));
      root.append(h('div', {class: 'pending-list'}, ...D.managers.filter(m => submitted.has(m.id)).map(m => h('span', {}, '✓ ' + m.name))));
      const miss = D.managers.filter(m => !submitted.has(m.id));
      if (miss.length) root.append(h('p', {class: 'lead'}, 'Still to submit: ' + miss.map(m => m.name).join(', ')));
      return;
    }

    // answer key: from polls.json, plus any taps saved on this device
    const key = keyAnswers();
    const kd = h('details', {class: 'keycard'}, h('summary', {}, 'Answer key (tap to set results)'));
    const setKey = (q, v) => { const k = ls.get(keyKey()) || {}; if (v === undefined) delete k[q.id]; else k[q.id] = v; ls.set(keyKey(), k); render(); };
    poll.questions.forEach((q, i) => {
      const c = h('div', {class: 'qcard'}, h('h3', {}, (i + 1) + '. ' + q.text));
      if (q.type === 'choice') {
        c.append(h('div', {class: 'opts'}, ...q.options.map(o => h('button', {class: 'opt', type: 'button',
          'aria-pressed': key[q.id] === o ? 'true' : 'false', onclick: () => setKey(q, key[q.id] === o ? undefined : o)}, o))));
      } else {
        const inp = h('input', {type: q.type === 'minute' ? 'number' : 'text', value: key[q.id] ?? '',
          placeholder: q.type === 'score' ? 'e.g. 2-1' : 'Minute'});
        inp.addEventListener('change', () => setKey(q, inp.value === '' ? undefined : (q.type === 'minute' ? parseInt(inp.value, 10) : inp.value.trim())));
        c.append(inp);
      }
      kd.append(c);
    });
    kd.append(h('p', {class: 'hint'}, 'Taps are saved in this browser only. To publish the final result for everyone, copy them into "answers" in data/polls/polls.json.'));
    root.append(kd);

    const rows = resp.map(r => {
      let total = 0;
      const cells = poll.questions.map(q => {
        const s = scoreQ(q, r.answers[q.id], key[q.id]);
        if (s) total += s;
        return {val: r.answers[q.id], s};
      });
      return {r, cells, total};
    }).sort((a, b) => b.total - a.total || a.r.name.localeCompare(b.r.name));

    const anyKey = poll.questions.some(q => key[q.id] !== undefined);
    const max = poll.questions.reduce((t, q) => t + q.points, 0);
    const fmt = (q, v) => v === undefined ? '–' : q.type === 'minute' ? v + "'" : String(v);
    // compact grid: one narrow cell per question showing points earned; tap a row for the picks
    let rank = 0, prev = null;
    const body = [];
    rows.forEach((row, i) => {
      if (row.total !== prev) { rank = i + 1; prev = row.total; }
      const detail = h('tr', {class: 'rdetail', hidden: true}, h('td', {colspan: poll.questions.length + 3},
        h('div', {class: 'rpicks'}, ...poll.questions.map((q, qi) => {
          const c = row.cells[qi];
          return h('div', {class: c.s ? 'ok' : ''}, h('span', {class: 'rq'}, 'Q' + (qi + 1)), ' ', fmt(q, row.r.answers[q.id]),
            anyKey && key[q.id] !== undefined ? (c.s ? ' ✓ +' + c.s : ' ✗') : '');
        }))));
      const tr = h('tr', {class: 'rrow', onclick: () => { detail.hidden = !detail.hidden; tr.classList.toggle('open', !detail.hidden); }},
        h('td', {}, anyKey ? String(rank) : ''),
        h('td', {class: 'rname'}, row.r.name, h('div', {class: 'tm'}, row.r.team)),
        h('td', {class: 'pts'}, anyKey ? String(row.total) : ''),
        ...row.cells.map(c => h('td', {class: 'rq' + (c.s ? ' ok' : (c.s === 0 ? ' no' : ''))}, c.s === null ? '·' : String(c.s))));
      body.push(tr, detail);
    });
    const table = h('table', {class: 'compact'},
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Manager'), h('th', {}, anyKey ? 'Pts' : ''),
        ...poll.questions.map((q, i) => h('th', {title: q.text}, String(i + 1))))),
      h('tbody', {}, ...body));
    root.append(h('div', {class: 'rgrid'}, table),
      h('p', {class: 'hint'}, 'Columns 1–' + poll.questions.length + ' are points per question' + (anyKey ? ' (out of ' + max + ' total)' : '') + '. Tap a manager to see their picks.'));
    if (anyKey) {
      const top = rows[0].total;
      const winners = rows.filter(r => r.total === top).map(r => r.r.name);
      root.prepend(h('div', {class: 'pbanner good'}, '🏆 ' + (winners.length > 1 ? 'Tied lead: ' : 'Leader: ') + winners.join(', ') + ' · ' + top + ' pts'));
    }
  }

  // ------------------------------------------------------------- shell
  function render() {
    document.querySelectorAll('.topbar nav a[data-tab]').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    const banner = $('#poll-banner');
    banner.replaceChildren();
    if (!SB) banner.append(h('div', {class: 'pbanner warn'}, 'Polls are not live yet: the database has not been connected (see scripts/polls_supabase.sql).'));
    else if (serverErr) banner.append(h('div', {class: 'pbanner warn'}, serverErr));
    else if (closesAt) banner.append(h('div', {class: 'pbanner' + (isClosed() ? ' warn' : '')}, isClosed() ? 'Poll closed at kickoff.' : '⏱ Locks at ' + closesAt.toLocaleString()));

    const p = $('#view-predict'), r = $('#view-responses');
    p.replaceChildren(); r.replaceChildren();
    p.hidden = tab !== 'predict'; r.hidden = tab !== 'responses';
    if (tab === 'predict') renderPredict(p); else renderResponses(r);
  }

  document.querySelectorAll('.topbar nav a[data-tab]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); tab = a.dataset.tab; history.replaceState(null, '', '#' + tab); render();
  }));

  const saved = ls.get(myKey());
  if (saved) { me = D.managers.find(m => m.id === saved) || null; if (me) draft = ls.get(draftKey()) || {}; }
  render(); load();
})();
