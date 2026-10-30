// Read and snooze state works on local pages before private-repo sync.
(function () {
  var states = {}, pending = {}, carried = {};
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  states = load('dp-reading-v1'); pending = load('dp-reading-pending-v1'); carried = load('dp-reading-carried-v1');
  function valid(v) {
    return v && typeof v.read === 'boolean' && /^[A-Za-z0-9._-]+$/.test(v.key || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(v.origin_date || '') && !isNaN(Date.parse(v.at)) &&
      (v.snooze_until === null || /^\d{4}-\d{2}-\d{2}$/.test(v.snooze_until || ''));
  }
  Object.keys(states).forEach(function (k) { if (!valid(states[k])) delete states[k]; });
  Object.keys(pending).forEach(function (k) { if (!valid(pending[k])) delete pending[k]; });
  function tomorrow() {
    var zone = document.querySelector('meta[name="dp-timezone"]');
    var day;
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: zone ? zone.content : 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var values = {}; parts.forEach(function (p) { values[p.type] = p.value; });
      day = values.year + '-' + values.month + '-' + values.day;
    } catch (e) { day = new Date().toISOString().slice(0, 10); }
    return new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  function labels(box, state) {
    var lang = document.documentElement.lang || 'en';
    var read = box.querySelector('[data-action="read"]');
    if (read) {
      read.classList.toggle('on', !!state.read);
      read.setAttribute('aria-pressed', String(!!state.read));
      read.textContent = read.getAttribute(state.read ? 'data-undo' : 'data-label') || (state.read ? 'Mark unread' : 'Read');
    }
    var owner = box.closest('.card, main.paper, li');
    if (owner) { owner.classList.toggle('is-read', !!state.read); owner.classList.toggle('is-snoozed', !!state.snooze_until && !state.read); }
    var status = box.querySelector('.reading-status'), sync = box.querySelector('.reading-sync');
    if (sync) sync.hidden = !pending[state.key];
    if (status) status.textContent = pending[state.key] ? (lang === 'ko' ? '이 기기에 저장됨' : 'Saved on this device') :
      state.snooze_until && !state.read ? (lang === 'ko' ? '미룬 날짜: ' : 'Snoozed until: ') + state.snooze_until : '';
  }
  function paint() {
    document.querySelectorAll('.reading[data-key]').forEach(function (box) { labels(box, states[box.getAttribute('data-key')] || {}); });
    save('dp-reading-v1', states); save('dp-reading-pending-v1', pending);
  }
  function metadata(box, state) {
    state.title = box.getAttribute('data-title') || state.key;
    state.topics = box.getAttribute('data-topics') || 'Other';
    ['en', 'ko'].forEach(function (lang) {
      var href = box.getAttribute('data-summary-' + lang);
      if (href) { try { state[lang] = new URL(href, location.href).href; } catch (e) {} }
    });
    return state;
  }
  function bind(box) {
    var key = box.getAttribute('data-key');
    var initial = { key: key, origin_date: box.getAttribute('data-origin-date'), read: box.getAttribute('data-read') === 'true',
      snooze_until: box.getAttribute('data-snooze-until') || null, at: box.getAttribute('data-state-at') || '1970-01-01T00:00:00Z' };
    if (valid(initial) && (!states[key] || Date.parse(initial.at) > Date.parse(states[key].at))) states[key] = metadata(box, initial);
    else if (states[key]) metadata(box, states[key]);
    box.querySelectorAll('.reading-btn[data-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var current = states[key] || initial;
        var state = { key: key, origin_date: box.getAttribute('data-origin-date'), read: !!current.read,
          snooze_until: current.snooze_until || null, at: new Date(Math.max(Date.now(), Date.parse(current.at) + 1)).toISOString() };
        if (button.getAttribute('data-action') === 'read') { state.read = !state.read; if (state.read) state.snooze_until = null; }
        else { state.read = false; state.snooze_until = tomorrow(); }
        states[key] = metadata(box, state); pending[key] = state;
        paint();
        if (window.dpReading.remote) window.dpReading.remote(false);
      });
    });
    var sync = box.querySelector('.reading-sync');
    if (sync) sync.addEventListener('click', function () { if (window.dpReading.remote) window.dpReading.remote(true); });
  }
  function applyRemote(value) {
    if (!valid(value)) return;
    var old = states[value.key];
    if (!old || Date.parse(value.at) >= Date.parse(old.at)) {
      states[value.key] = Object.assign({}, old || {}, value);
      if (pending[value.key] && Date.parse(pending[value.key].at) <= Date.parse(value.at)) delete pending[value.key];
    }
    paint();
  }
  window.dpReading = { states: states, pending: pending, paint: paint, applyRemote: applyRemote,
    acknowledge: function (key, at) { if (pending[key] && pending[key].at === at) delete pending[key]; paint(); } };
  document.querySelectorAll('.reading[data-key]').forEach(bind);
  // Local actions can appear in a later issue before the server syncs them.
  var issue = document.querySelector('meta[name="dp-issue-date"]'), toolbar = document.querySelector('.toolbar');
  if (issue && toolbar) {
    var due = Object.keys(states).filter(function (key) {
      var state = states[key], event = key + '@' + state.at;
      return !state.read && state.snooze_until && state.snooze_until <= issue.content && state.origin_date < issue.content &&
        (!carried[event] || carried[event] === issue.content) && (state.en || state.ko) &&
        !document.querySelector('.snoozed .reading[data-key="' + key + '"]');
    });
    if (due.length) {
      var section = document.querySelector('.snoozed'), list;
      if (!section) {
        section = document.createElement('section'); section.className = 'snoozed';
        var heading = document.createElement('h2'); heading.textContent = document.documentElement.lang === 'ko' ? '어제 미뤄둔 논문 / Snoozed' : 'Snoozed'; section.appendChild(heading);
        list = document.createElement('div'); list.className = 'cards'; section.appendChild(list); toolbar.insertAdjacentElement('afterend', section);
      } else { list = section.querySelector('.cards'); }
      due.forEach(function (key) {
        var state = states[key], card = document.createElement('article'); card.className = 'card'; card.setAttribute('data-topics', state.topics || 'Other'); card.setAttribute('data-search', (state.title || '').toLowerCase());
        var body = document.createElement('div'); body.className = 'card-body'; var title = document.createElement('h2'); var a = document.createElement('a');
        a.href = state.ko || state.en; a.textContent = state.title || key; title.appendChild(a); body.appendChild(title);
        var vote = document.createElement('span'); vote.className = 'vote'; vote.setAttribute('data-key', key); vote.setAttribute('data-date', state.origin_date);
        ['up', 'down'].forEach(function (value) { var button = document.createElement('button'); button.type = 'button'; button.className = 'vote-btn'; button.setAttribute('data-vote', value); button.setAttribute('aria-label', value === 'up' ? 'Like' : 'Not interested'); button.textContent = value === 'up' ? '👍' : '👎'; vote.appendChild(button); }); body.appendChild(vote);
        var box = document.createElement('span'); box.className = 'reading';
        var attrs = { 'data-key': key, 'data-origin-date': state.origin_date, 'data-read': String(state.read), 'data-snooze-until': state.snooze_until || '', 'data-state-at': state.at, 'data-title': state.title || key, 'data-topics': state.topics || 'Other', 'data-summary-ko': state.ko || '' };
        Object.keys(attrs).forEach(function (name) { box.setAttribute(name, attrs[name]); });
        ['read', 'snooze'].forEach(function (action) { var b = document.createElement('button'); b.className = 'reading-btn'; b.setAttribute('data-action', action); b.setAttribute('data-label', document.documentElement.lang === 'ko' ? '읽음' : 'Read'); b.setAttribute('data-undo', document.documentElement.lang === 'ko' ? '읽음 취소' : 'Mark unread'); b.textContent = action === 'read' ? b.getAttribute('data-label') : document.documentElement.lang === 'ko' ? '내일로 미루기' : 'Snooze to tomorrow'; box.appendChild(b); });
        var sync = document.createElement('button'); sync.className = 'reading-sync'; sync.textContent = document.documentElement.lang === 'ko' ? '동기화' : 'Sync'; box.appendChild(sync);
        var status = document.createElement('small'); status.className = 'reading-status'; box.appendChild(status); body.appendChild(box); card.appendChild(body); list.appendChild(card); bind(box);
        carried[key + '@' + state.at] = issue.content;
        var filters = document.querySelector('.filters');
        if (filters && !document.querySelector('.filter[data-topic="__snoozed__"]')) {
          var filter = document.createElement('button'); filter.className = 'filter'; filter.setAttribute('data-topic', '__snoozed__'); filter.textContent = (document.documentElement.lang === 'ko' ? '미룬 논문' : 'Snoozed') + ' '; var count = document.createElement('b'); filter.appendChild(count); filters.appendChild(filter);
        }
      });
      save('dp-reading-carried-v1', carried);
    }
  }
  paint();
})();

// Daily Papers — topic filter, search, language memory
(function () {
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  document.querySelectorAll('.lang a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () { store('dp-lang', a.dataset.lang); });
  });

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  cards = cards.filter(function (card) { return !card.closest('.essential-paper'); });
  if (!cards.length) return;
  var filters = document.querySelectorAll('.filter');
  var search = document.querySelector('.search');
  var topic = '';

  var sections = document.querySelectorAll('.topic-sec, .snoozed');
  filters.forEach(function (b) {
    var count = b.querySelector('b');
    if (count) count.textContent = cards.filter(function (c) {
      var carried = !!c.closest('.snoozed');
      return b.dataset.topic === '__snoozed__' ? carried : !carried && (!b.dataset.topic || c.dataset.topics === b.dataset.topic);
    }).length;
  });
  var otherItems = document.querySelectorAll('.others li[data-topics]');

  function hasTopic(el) {
    if (!topic) return true;
    var carried = !!el.closest('.snoozed');
    if (topic === '__snoozed__') return carried;
    return !carried && (el.dataset.topics || '').split('|').indexOf(topic) >= 0;
  }
  function apply() {
    var q = (search && search.value || '').trim().toLowerCase();
    cards.forEach(function (c) {
      var okText = !q || (c.dataset.search || '').indexOf(q) >= 0;
      c.hidden = !(hasTopic(c) && okText);
    });
    sections.forEach(function (s) {
      s.hidden = !s.querySelector('.card:not([hidden])');
    });
    otherItems.forEach(function (li) { li.hidden = !hasTopic(li); });
  }
  filters.forEach(function (b) {
    b.addEventListener('click', function () {
      filters.forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      topic = b.dataset.topic || '';
      apply();
    });
  });
  if (search) search.addEventListener('input', apply);
})();

// ---------------------------------------------------------------- 👍 / 👎 feedback
// Votes go straight from this browser to a private GitHub repo through api.github.com (no other
// server is involved). The repo name comes from <meta name="dp-feedback"> inside the page (which
// the published site encrypts). The reader's fine-grained token (Contents read/write on that one
// repo) is kept only in this browser's localStorage, AES-GCM-encrypted with the site key when the
// page was unlocked with the password, and is only ever sent to api.github.com.
(function () {
  var meta = document.querySelector('meta[name="dp-feedback"]');
  var boxes = document.querySelectorAll('.vote[data-key]');
  var readingBoxes = document.querySelectorAll('.reading[data-key]');
  if (!meta || !(boxes.length || readingBoxes.length) || !window.crypto || !crypto.subtle) return;
  // Only on the password-protected published site: the site key is what encrypts the token here.
  // On the plain local site the buttons stay hidden, so a token is never stored in clear text.
  if (!siteKeyRawEarly()) { boxes.forEach(function (b) { b.style.display = 'none'; }); if (!readingBoxes.length) return; }
  function siteKeyRawEarly() {
    try {
      return [sessionStorage, localStorage].some(function (st) {
        return Object.keys(st).some(function (k) { return k.indexOf('rn-key-') === 0; });
      });
    } catch (e) { return false; }
  }
  var API = 'https://api.github.com/repos/' + meta.content + '/contents/votes';
  var TK = 'dp-fb-token';
  var votes = {}, memoryToken = null;

  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (x) { s += String.fromCharCode(x); }); return btoa(s); }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function siteKeyRaw() {
    try {
      var stores = [sessionStorage, localStorage];
      for (var i = 0; i < stores.length; i++) {
        var ks = Object.keys(stores[i]);
        for (var j = 0; j < ks.length; j++) if (ks[j].indexOf('rn-key-') === 0) return stores[i].getItem(ks[j]);
      }
    } catch (e) {}
    return null;
  }
  function aesKey() {
    var raw = siteKeyRaw();
    return raw ? crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
               : Promise.resolve(null);
  }
  async function saveToken(tok) {
    var key = await aesKey();
    if (!key) return false;  // never store the token unencrypted
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(tok));
    try { localStorage.setItem(TK, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) })); } catch (e) { return false; }
    return true;
  }
  async function loadToken() {
    if (memoryToken) return memoryToken;
    var rec;
    try { rec = JSON.parse(localStorage.getItem(TK) || 'null'); } catch (e) { rec = null; }
    if (!rec || !rec.ct) return null;
    var key = await aesKey();
    if (!key) return null;
    try {
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
      return new TextDecoder().decode(pt);
    } catch (e) { return null; }  // site password changed: ask again
  }
  function forgetToken() { memoryToken = null; try { localStorage.removeItem(TK); } catch (e) {} }

  function askToken() {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'fb-modal';
      wrap.innerHTML =
        '<form class="fb-box"><h3>피드백 토큰</h3>' +
        '<p>👍/👎와 읽음·미루기를 동기화하려면 피드백 repo 전용 GitHub fine-grained 토큰이 필요해요. ' +
        '게시 사이트에서는 이 브라우저에 암호화해 저장합니다. 로컬 사이트에서는 메모리에만 보관합니다. api.github.com으로만 보냅니다.</p>' +
        '<input type="password" autocomplete="off" spellcheck="false" placeholder="fine-grained 토큰 붙여넣기" required>' +
        '<p class="fb-err" hidden>토큰을 확인할 수 없어요. repo 접근 권한을 확인해 주세요.</p>' +
        '<div class="fb-row"><button type="button" class="fb-cancel">취소</button>' +
        '<button type="submit">저장</button></div></form>';
      document.body.appendChild(wrap);
      var input = wrap.querySelector('input'), err = wrap.querySelector('.fb-err');
      input.focus();
      wrap.querySelector('.fb-cancel').onclick = function () { wrap.remove(); resolve(null); };
      wrap.querySelector('form').onsubmit = async function (ev) {
        ev.preventDefault();
        var tok = input.value.trim();
        var r = await fetch('https://api.github.com/repos/' + meta.content,
                            { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' } });
        if (!r.ok) { err.hidden = false; return; }
        input.value = '';
        memoryToken = tok;
        await saveToken(tok);
        wrap.remove();
        resolve(tok);
      };
    });
  }

  function gh(method, url, tok, body) {
    return fetch(url, { method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' },
      body: body ? JSON.stringify(body) : undefined });
  }

  var READING_API = 'https://api.github.com/repos/' + meta.content + '/contents/reading';
  var readingBusy = false;
  async function refreshReading(tok) {
    var response = await gh('GET', READING_API, tok);
    if (response.status === 404) return;
    if (!response.ok) throw response.status;
    var items = await response.json();
    if (!Array.isArray(items)) throw 'invalid reading list';
    // Only fetch keys used on this page or in the local queue. The server syncs the full folder.
    var wanted = {};
    readingBoxes.forEach(function (box) { wanted[box.getAttribute('data-key')] = true; });
    Object.keys(window.dpReading.pending).forEach(function (key) { wanted[key] = true; });
    for (var i = 0; i < items.length; i++) {
      var match = /^([A-Za-z0-9._-]+)\.json$/.exec(items[i].name);
      if (!match || !wanted[match[1]]) continue;
      var item = await gh('GET', READING_API + '/' + items[i].name, tok);
      if (!item.ok) throw item.status;
      var record = await item.json();
      try { window.dpReading.applyRemote(JSON.parse(new TextDecoder().decode(unb64(record.content.replace(/\s/g, ''))))); } catch (e) {}
    }
  }
  async function syncReading(ask) {
    if (readingBusy) return;
    readingBusy = true;
    try {
      var tok = await loadToken() || (ask ? await askToken() : null);
      if (!tok) return;
      var queued = Object.keys(window.dpReading.pending);
      for (var i = 0; i < queued.length; i++) {
        var key = queued[i], state = window.dpReading.pending[key];
        if (!state) continue;
        var payload = { key: key, id: key, origin_date: state.origin_date, read: state.read, snooze_until: state.snooze_until, at: state.at };
        var url = READING_API + '/' + key + '.json';
        for (var attempt = 0; attempt < 2; attempt++) {
          var current = await gh('GET', url, tok), body = { message: 'reading state', content: b64(new TextEncoder().encode(JSON.stringify(payload))) };
          if (current.ok) {
            var remote = await current.json(); body.sha = remote.sha;
            try {
              var newer = JSON.parse(new TextDecoder().decode(unb64(remote.content.replace(/\s/g, ''))));
              if (Date.parse(newer.at) > Date.parse(payload.at)) { window.dpReading.applyRemote(newer); break; }
            } catch (e) {}
          }
          else if (current.status !== 404) throw current.status;
          var put = await gh('PUT', url, tok, body);
          if (put.ok) { window.dpReading.acknowledge(key, payload.at); break; }
          if (put.status !== 409 || attempt === 1) throw put.status;
        }
      }
      await refreshReading(tok);
    } catch (status) {
      if (status === 401 || status === 403) forgetToken();
      // Keep local actions queued. The reader can use Sync to try again.
    } finally { readingBusy = false; window.dpReading.paint(); }
  }
  window.dpReading.remote = syncReading;

  // remember the server's order so un-voting puts a card back where it was
  document.querySelectorAll('.topic-sec .cards').forEach(function (list) {
    Array.prototype.forEach.call(list.children, function (c, i) { c.setAttribute('data-order', i); });
  });
  function reorder() {  // within each topic: 👍 first, 👎 last, the rest in the server's order
    document.querySelectorAll('.topic-sec .cards').forEach(function (list) {
      var cards = Array.prototype.slice.call(list.children);
      var rank = function (c) {
        var box = c.querySelector('.vote[data-key]'), v = box && votes[box.getAttribute('data-key')];
        return v ? (v.vote === 'up' ? 0 : 2) : 1;
      };
      cards.sort(function (a, b) {
        return rank(a) - rank(b) || (+a.getAttribute('data-order')) - (+b.getAttribute('data-order'));
      }).forEach(function (c) { list.appendChild(c); });
    });
  }
  function paint() {
    boxes.forEach(function (box) {
      var v = votes[box.getAttribute('data-key')];
      box.querySelectorAll('.vote-btn').forEach(function (b) {
        b.classList.toggle('on', !!v && v.vote === b.getAttribute('data-vote'));
      });
    });
    reorder();
  }
  async function refresh(tok) {
    var r = await gh('GET', API + '?per_page=1000', tok);
    if (r.status === 401 || r.status === 403) { forgetToken(); return false; }
    votes = {};
    if (r.ok) {
      (await r.json()).forEach(function (f) {
        var m = /^(\d{4}-\d{2}-\d{2})__([A-Za-z0-9._-]+)\.(up|down)\.json$/.exec(f.name);
        if (m) votes[m[2]] = { vote: m[3], name: f.name, sha: f.sha };
      });
    }
    paint();
    return true;
  }
  async function vote(box, want) {
    var tok = await loadToken() || await askToken();
    if (!tok) return;
    if (!Object.keys(votes).length && !(await refresh(tok))) { tok = await askToken(); if (!tok) return; await refresh(tok); }
    var key = box.getAttribute('data-key'), date = box.getAttribute('data-date'), cur = votes[key];
    box.classList.add('busy');
    try {
      if (cur) {
        var d = await gh('DELETE', API + '/' + cur.name, tok, { message: 'unvote', sha: cur.sha });
        if (!d.ok && d.status !== 404) throw d.status;
        delete votes[key];
      }
      if (!cur || cur.vote !== want) {
        var name = date + '__' + key + '.' + want + '.json';
        var content = btoa(JSON.stringify({ id: key, date: date, vote: want, at: new Date().toISOString() }));
        var p = await gh('PUT', API + '/' + name, tok, { message: 'vote', content: content });
        if (!p.ok) throw p.status;
        votes[key] = { vote: want, name: name, sha: (await p.json()).content.sha };
      }
    } catch (status) {
      if (status === 401 || status === 403) forgetToken();
      alert('저장하지 못했어요 (' + status + '). 잠시 후 다시 시도해 주세요.');
      await refresh(tok);
    }
    box.classList.remove('busy');
    paint();
  }

  boxes.forEach(function (box) {
    box.querySelectorAll('.vote-btn').forEach(function (b) {
      b.addEventListener('click', function () { vote(box, b.getAttribute('data-vote')); });
    });
  });
  loadToken().then(function (tok) { if (tok) { refresh(tok); syncReading(false); } });

  var foot = document.querySelector('.foot');
  if (foot) {
    var a = document.createElement('a');
    a.href = '#'; a.className = 'fb-forget'; a.textContent = '피드백 토큰 지우기';
    a.onclick = function (ev) { ev.preventDefault(); forgetToken(); votes = {}; paint(); alert('이 브라우저에서 토큰을 지웠어요.'); };
    foot.appendChild(document.createElement('br')); foot.appendChild(a);
  }
})();

// Original paper beside the summary. PDF.js loads only on first open. Its code and wasm decoders are
// pinned by hash (fetch integrity), so a changed CDN file does not run. A failed load offers a retry
// and a new tab.
(function () {
  var button = document.querySelector('.pdf-toggle[data-pdf]');
  if (!button) return;
  var CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/';
  var LIB = { 'legacy/build/pdf.min.mjs': 'sha384-oPqHr8MeYfJpkh4zgHbWYiuwabTzthRiOS5tSWsWGmCVWlwqIkS9coGro5aa48OF',
    'legacy/build/pdf.worker.min.mjs': 'sha384-tINN5IYq7dFaoHBUBBc2yfxGwR38mZn9GhaX31UofKYNgAg/3y8A7IjUI3GuEg/8' };
  var WASM = { 'jbig2.wasm': 'sha384-iaCfit7ahDwR6i0sUBtQtjqoUs/cixFPu1hRkl4j14vBZ9WWoGkJhy0wQ9N9P5ED',
    'openjpeg.wasm': 'sha384-OdK9ZwgKG5chdO/ubahcXAr5YyeH/RQw9bwR9BkFC6g96FbwgZupMBEWN8WOsRdG' };
  var STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  var url = button.getAttribute('data-pdf'), root = document.documentElement;
  var panel, view, level, status, doc, pages = [], base = null, zoom = 1, timer = 0, frame = 0, opened = false, library, loading;
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function narrow() { return window.matchMedia('(max-width: 900px)').matches; }
  function width(px) {
    var w = Math.max(320, Math.min(px, window.innerWidth - 360));
    root.style.setProperty('--pdf-w', w + 'px');
    return w;
  }
  function load() {
    if (library) return library;
    function blob(path) {
      return fetch(CDN + path, { integrity: LIB[path], credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('PDF.js ' + r.status);
        return r.blob();
      }).then(function (b) { return URL.createObjectURL(new Blob([b], { type: 'text/javascript' })); });
    }
    library = Promise.all([blob('legacy/build/pdf.min.mjs'), blob('legacy/build/pdf.worker.min.mjs')]).then(function (u) {
      return import(u[0]).then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(u[1], { type: 'module' });
        return pdfjs;
      });
    });
    library.catch(function () { library = null; });
    return library;
  }
  // All binary data goes through the page (useWorkerFetch: false), never the worker. wasmUrl stays
  // unset, so the worker cannot import the unpinned *_nowasm_fallback.js files and skips ICC (qcms).
  // Wasm decoders need a pinned hash. CMaps and standard fonts are data, not code.
  function Binary() {}
  Binary.prototype.fetch = function (o) {
    var dir = { cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/' }[o.kind];
    var sri = o.kind === 'wasmUrl' ? WASM[o.filename] : '';
    if (!dir || !/^[A-Za-z0-9._-]+$/.test(o.filename || '') || (o.kind === 'wasmUrl' && !sri))
      return Promise.reject(new Error('PDF.js data not allowed: ' + o.kind + ' ' + o.filename));
    return fetch(CDN + dir + o.filename, sri ? { integrity: sri, credentials: 'omit' } : { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('PDF.js data ' + r.status); return r.arrayBuffer(); })
      .then(function (b) { return new Uint8Array(b); });
  };
  function retryButton(label, action) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pdf-retry'; b.textContent = label;
    b.addEventListener('click', action);
    return b;
  }
  function fail() {
    status.hidden = false;
    status.textContent = '';
    status.appendChild(document.createTextNode('이 창에서 원문을 불러오지 못했습니다. '));
    status.appendChild(retryButton('다시 시도', start));
    status.appendChild(document.createTextNode(' '));
    var a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '새 탭에서 열기';
    status.appendChild(a);
  }
  function scale() { return base ? zoom * Math.max(200, view.clientWidth - 24) / base : 1; }
  function layout() {
    var s = scale();
    pages.forEach(function (p) {
      var w = Math.floor(p.w * s), h = Math.floor(p.h * s);
      p.box.style.width = w + 'px'; p.box.style.height = h + 'px';
      if (p.canvas) { p.canvas.style.width = w + 'px'; p.canvas.style.height = h + 'px'; }
    });
    level.textContent = Math.round(zoom * 100) + '%';
  }
  // p.done: scale drawn on screen. p.want: scale being drawn now. p.failed: scale that failed; it is
  // not retried on scroll (a zoom change or the page's retry button tries again).
  function draw(p, force) {
    var s = scale();
    if (p.done === s || p.want === s || (p.failed === s && !force)) return;
    p.want = s; p.failed = null;
    if (p.task) { p.task.cancel(); p.task = null; }
    var error = p.box.querySelector('.pdf-page-error');
    if (error) error.remove();
    doc.getPage(p.n).then(function (page) {
      if (p.want !== s) return;
      var vp = page.getViewport({ scale: s });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      while (vp.width * vp.height * dpr * dpr > 16e6 && dpr > 0.5) dpr /= 1.5;
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
      var task = p.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
      return task.promise.then(function () {
        if (p.task === task) p.task = null;
        if (p.want !== s) return;
        p.want = null; p.done = s;
        p.box.textContent = ''; p.box.appendChild(canvas); p.canvas = canvas;
      });
    }).catch(function (err) {
      if (p.want !== s) return;  // a newer draw replaced this one
      p.want = null;
      if (err && err.name === 'RenderingCancelledException') return;
      p.failed = s;
      var box = document.createElement('p'); box.className = 'pdf-page-error'; box.setAttribute('role', 'status');
      box.appendChild(document.createTextNode(p.n + '쪽을 그리지 못했습니다. '));
      box.appendChild(retryButton('다시 그리기', function () { draw(p, true); }));
      p.box.appendChild(box);
    });
  }
  function paint() {
    frame = 0;
    if (!doc || !opened) return;
    var top = view.scrollTop - view.clientHeight, bottom = view.scrollTop + 2 * view.clientHeight;
    pages.forEach(function (p) {
      if (p.box.offsetTop + p.box.offsetHeight >= top && p.box.offsetTop <= bottom) draw(p);
    });
  }
  function later() { if (!frame) frame = requestAnimationFrame(paint); }
  // Keep the point under the cursor (or the view centre) in place while the scale changes.
  function setZoom(z, x, y) {
    z = Math.max(STEPS[0], Math.min(STEPS[STEPS.length - 1], z));
    if (!doc || Math.abs(z - zoom) < 1e-3) return;
    if (x == null) { x = view.clientWidth / 2; y = view.clientHeight / 2; }
    var fx = (view.scrollLeft + x) / view.scrollWidth, fy = (view.scrollTop + y) / view.scrollHeight;
    zoom = z;
    layout();
    view.scrollLeft = fx * view.scrollWidth - x; view.scrollTop = fy * view.scrollHeight - y;
    clearTimeout(timer); timer = setTimeout(later, 150);
  }
  function step(dir) {
    var next = dir > 0 ? STEPS.filter(function (z) { return z > zoom + 1e-3; })[0]
      : STEPS.filter(function (z) { return z < zoom - 1e-3; }).pop();
    if (next) setZoom(next);
  }
  function start() {
    if (doc || loading) return;
    pages.forEach(function (p) { p.box.remove(); }); pages = [];
    status.hidden = false; status.textContent = '원문을 불러오는 중…';
    loading = load().then(function (pdfjs) {
      return pdfjs.getDocument({ url: url, isEvalSupported: false, withCredentials: false,
        useWorkerFetch: false, BinaryDataFactory: Binary, cMapPacked: true }).promise;
    }).then(function (pdf) {
      doc = pdf;
      return pdf.getPage(1);
    }).then(function (first) {
      var vp = first.getViewport({ scale: 1 });
      base = vp.width;
      for (var n = 1; n <= doc.numPages; n++) {
        var box = document.createElement('div'); box.className = 'pdf-page';
        box.setAttribute('data-page', n);
        view.appendChild(box);
        pages.push({ n: n, w: vp.width, h: vp.height, box: box });
      }
      status.hidden = true;
      // Pages can differ in size: correct each placeholder from its own page.
      pages.forEach(function (p) {
        doc.getPage(p.n).then(function (page) {
          var v = page.getViewport({ scale: 1 });
          if (v.width !== p.w || v.height !== p.h) { p.w = v.width; p.h = v.height; layout(); }
        });
      });
      layout(); later();
    }).catch(function () { doc = null; fail(); }).then(function () { loading = null; });
  }
  function build() {
    panel = document.createElement('aside');
    panel.className = 'pdf-panel'; panel.setAttribute('aria-label', '원문 PDF'); panel.hidden = true;
    panel.innerHTML = '<div class="pdf-resize" role="separator" aria-orientation="vertical" aria-label="패널 너비 조절" tabindex="0"></div>' +
      '<div class="pdf-bar"><span class="pdf-title">원문</span>' +
      '<button type="button" data-zoom="out" title="축소" aria-label="축소">−</button>' +
      '<button type="button" class="pdf-level" data-zoom="fit" title="폭에 맞춤" aria-label="폭에 맞춤">100%</button>' +
      '<button type="button" data-zoom="in" title="확대" aria-label="확대">+</button>' +
      '<a class="pdf-tab" target="_blank" rel="noopener">새 탭</a>' +
      '<button type="button" class="pdf-close" title="닫기" aria-label="닫기">×</button></div>' +
      '<div class="pdf-view" tabindex="0"><p class="pdf-status" role="status"></p></div>';
    document.body.appendChild(panel);
    view = panel.querySelector('.pdf-view'); level = panel.querySelector('.pdf-level'); status = panel.querySelector('.pdf-status');
    panel.querySelector('.pdf-tab').href = url;
    panel.querySelector('[data-zoom="in"]').addEventListener('click', function () { step(1); });
    panel.querySelector('[data-zoom="out"]').addEventListener('click', function () { step(-1); });
    level.addEventListener('click', function () { setZoom(1); });
    panel.querySelector('.pdf-close').addEventListener('click', toggle);
    view.addEventListener('scroll', later, { passive: true });
    // Ctrl/Cmd + wheel and trackpad pinch zoom the paper, not the page.
    view.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      var r = view.getBoundingClientRect();
      setZoom(zoom * Math.exp(-ev.deltaY * 0.002), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
    var pinch = null;
    function gap(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    view.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2) pinch = { d: gap(ev.touches), z: zoom };
    }, { passive: true });
    view.addEventListener('touchmove', function (ev) {
      if (!pinch || ev.touches.length !== 2) return;
      ev.preventDefault();
      var r = view.getBoundingClientRect();
      setZoom(pinch.z * gap(ev.touches) / pinch.d,
        (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left, (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top);
    }, { passive: false });
    view.addEventListener('touchend', function (ev) { if (ev.touches.length < 2) pinch = null; });
    view.addEventListener('keydown', function (ev) {
      if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); step(1); }
      else if (ev.key === '-') { ev.preventDefault(); step(-1); }
      else if (ev.key === '0') { ev.preventDefault(); setZoom(1); }
    });
    panel.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { toggle(); button.focus(); } });
    var handle = panel.querySelector('.pdf-resize');
    handle.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); handle.setPointerCapture(ev.pointerId); root.classList.add('pdf-dragging');
      function move(e) { width(window.innerWidth - e.clientX); layout(); }
      function up() {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        root.classList.remove('pdf-dragging');
        store('dp-pdf-width', parseInt(getComputedStyle(root).getPropertyValue('--pdf-w'), 10));
        later();
      }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', function (ev) {
      var d = ev.key === 'ArrowLeft' ? 40 : ev.key === 'ArrowRight' ? -40 : 0;
      if (!d) return;
      ev.preventDefault();
      store('dp-pdf-width', width(panel.offsetWidth + d)); layout(); later();
    });
    window.addEventListener('resize', function () { if (opened) { width(panel.offsetWidth); layout(); later(); } });
  }
  function toggle() {
    if (!panel) build();
    opened = !opened;
    panel.hidden = !opened;
    root.classList.toggle('pdf-open', opened);
    button.setAttribute('aria-expanded', String(opened));
    button.textContent = opened ? '원문 닫기' : '원문 나란히 보기';
    if (!opened) return;
    width(parseInt(stored('dp-pdf-width'), 10) || Math.round(window.innerWidth / 2));
    if (!doc) start(); else { layout(); later(); }
    if (narrow()) view.focus();
  }
  button.addEventListener('click', toggle);
})();
