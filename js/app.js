/*
 * 颱風應變檢核清單｜畫面
 * ---------------------------------------------------------------
 * 資料：window.TYPHOON_CHECKLIST（checklist-data.js，由 Excel 轉出，唯讀）
 * 儲存：window.TyphoonStore（store.js，整合時換成後端 API）
 * 這個檔案只負責畫面，不直接碰 localStorage（除了記住「這台裝置」上次看的頁面與篩選）。
 *
 * 三個頁面：檢核清單（勾選）／進度總覽（各部門 × 階段）／簡訊範本與話術（填入欄位、複製）
 */
(function () {
  'use strict';

  const DATA = window.TYPHOON_CHECKLIST;
  const Store = window.TyphoonStore;
  const Official = window.TyphoonOfficial; // official.js：官方公告解析與規則
  const SYSTEM = Official ? Official.SYSTEM_ACTOR : '系統';
  const OFFICIAL_POLL_MS = 5 * 60 * 1000;
  const UI_KEY = 'typhoon-checklist:ui';

  const PH = {}; DATA.phases.forEach((p, i) => { PH[p.id] = Object.assign({ n: i + 1 }, p); });
  const DEPT = {}; DATA.departments.forEach(d => { DEPT[d.id] = d; });
  const ITEM = {}; DATA.items.forEach(i => { ITEM[i.id] = i; });
  const TPL = {}; DATA.templates.forEach(t => { TPL[t.id] = t; });
  const GUIDE = {}; DATA.guides.forEach(g => { GUIDE[g.id] = g; });
  const KIND = { sms: '簡訊', message: '訊息', script: '話術', guide: '參考資料' };
  const STATUS = { todo: '未完成', done: '已完成', na: '不適用' };
  const PH_RE = /\{\{([^{}]+)\}\}/g;

  const state = {
    view: 'checklist', eventId: null, event: null, events: [], user: null, browse: false,
    dept: null, phase: 'current', show: 'all', q: '',
    expanded: {}, editingNote: null, vars: {}, openOriginals: {},
    settings: { watchedCounties: ['臺南市'], hqCounty: '臺南市', autoAdjust: true, autoCreate: true },
    official: null, offEval: null
  };

  // ---------- 小工具 ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  function fmt(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtFull(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }

  const ICON = {
    check: '<path d="M5 10.5l3.2 3.2L15 6.5"/>',
    msg: '<path d="M3.5 4.5h13v9h-7l-3.5 3v-3h-2.5z"/>',
    doc: '<path d="M5.5 2.5h6l3 3v12h-9z"/><path d="M11.5 2.5v3h3M8 10h4.5M8 13h4.5"/>',
    note: '<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11.5 5.5l3 3"/>',
    na: '<circle cx="10" cy="10" r="6.5"/><path d="M5.5 14.5l9-9"/>',
    copy: '<rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M13 4.5V4a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1H5"/>',
    download: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
    search: '<circle cx="9" cy="9" r="5.2"/><path d="M13 13l3.5 3.5"/>',
    x: '<path d="M5 5l10 10M15 5L5 15"/>',
    edit: '<path d="M4 16l1-4 8-8 3 3-8 8z"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10.5h6L14 6"/>',
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
    unlock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    eye: '<path d="M2.5 10s3-5.5 7.5-5.5 7.5 5.5 7.5 5.5-3 5.5-7.5 5.5S2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.3"/>',
    storm: '<path d="M15.5 4.5A7 7 0 0 0 3.2 9"/><path d="M4.5 15.5A7 7 0 0 0 16.8 11"/><circle cx="10" cy="10" r="2.6"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3.5v3.2h-3.2"/>',
    gear: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
    flask: '<path d="M8 3h4M8.5 3v5L4 16a1 1 0 0 0 .9 1.5h10.2A1 1 0 0 0 16 16l-4.5-8V3"/><path d="M6.2 12.5h7.6"/>'
  };
  const icon = (name, cls) => `<svg class="${cls || 'i'}" viewBox="0 0 20 20" aria-hidden="true">${ICON[name]}</svg>`;
  const CHECK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 6.5"/></svg>';

  // ---------- 這台裝置的畫面設定 ----------
  function restoreUi() {
    try {
      const u = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (['checklist', 'overview', 'templates', 'users'].includes(u.view)) state.view = u.view;
      if (u.eventId) state.eventId = u.eventId;
      if (u.dept && (u.dept === 'all' || DEPT[u.dept])) state.dept = u.dept;
      state.browse = !!u.browse;
    } catch (e) { /* 第一次使用或不能存 */ }
  }
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, eventId: state.eventId, dept: state.dept, browse: state.browse })); }
    catch (e) { /* 不影響使用 */ }
  }

  // ---------- 資料 ----------
  async function loadEvents() {
    state.events = await Store.listEvents();
    if (state.eventId && !state.events.some(e => e.id === state.eventId)) state.eventId = null;
    if (!state.eventId && !state.browse) {
      const pick = state.events.find(e => e.status === 'active') || state.events[0];
      state.eventId = pick ? pick.id : null;
    }
    state.event = state.eventId ? await Store.getEvent(state.eventId) : null;
  }
  const progressOf = id => (state.event && state.event.progress[id]) || { status: 'todo', note: '' };
  const statusOf = id => progressOf(id).status;
  // 畫面權限（雲端版由管理員在「人員與權限」設定；單機版全部可以）
  const canCheck = () => Store.can('check');
  const canManage = () => Store.can('manage');
  const canEdit = () => !!state.event && state.event.status !== 'closed' && canCheck();
  const isCloud = Store.mode === 'cloud';
  function effPhase() { return state.phase !== 'current' ? state.phase : (state.event ? state.event.currentPhase : 'all'); }
  function effDept() { return state.dept || (state.user && DEPT[state.user.dept] ? state.user.dept : 'all'); }
  function scopeItems(dept, phase) {
    return DATA.items.filter(i => (dept === 'all' || i.dept === dept) && (phase === 'all' || i.phase === phase));
  }
  function stats(items) {
    let done = 0, na = 0;
    items.forEach(i => { const s = statusOf(i.id); if (s === 'done') done++; else if (s === 'na') na++; });
    return { total: items.length, done, na, handled: done + na };
  }
  function filteredItems() {
    let list = scopeItems(effDept(), effPhase());
    if (state.show === 'todo') list = list.filter(i => statusOf(i.id) === 'todo');
    else if (state.show === 'done') list = list.filter(i => statusOf(i.id) !== 'todo');
    const q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter(i => [i.id, i.action, i.description, i.owner, i.deputy, i.linked, i.group, DEPT[i.dept].name, progressOf(i.id).note]
        .join(' ').toLowerCase().includes(q));
    }
    return list;
  }

  // ---------- 範本欄位 ----------
  function typhoonName(name) { const n = String(name || '').trim(); return !n || /颱風$/.test(n) ? n : n + '颱風'; }
  function currentVars() {
    // 沒有勾選權限的人填的值只留在自己的畫面（state.vars），不寫回共用的事件
    const v = Object.assign({}, state.event ? state.event.vars : {}, state.vars);
    if (!v['颱風名稱'] && state.event) v['颱風名稱'] = typhoonName(state.event.name);
    return v;
  }
  function placeholders(body) {
    const out = [];
    body.replace(PH_RE, (m, k) => { if (!out.includes(k)) out.push(k); return m; });
    return out;
  }
  function fill(t, vars) {
    const missing = [];
    let html = '';
    let text = '';
    let last = 0;
    t.body.replace(PH_RE, (m, k, at) => {
      const before = t.body.slice(last, at);
      html += esc(before); text += before;
      const v = (vars[k] || '').trim();
      if (v) { html += `<span class="fill">${esc(v)}</span>`; text += v; }
      else { if (!missing.includes(k)) missing.push(k); html += `<span class="ph">${esc(k)}</span>`; text += `【${k}】`; }
      last = at + m.length;
      return m;
    });
    html += esc(t.body.slice(last)); text += t.body.slice(last);
    return { html, text, missing };
  }
  function checksHtml(t, r) {
    const out = [`<span>字數 ${r.text.length}</span>`];
    if (r.missing.length) out.push(`<span class="warn">還有 ${r.missing.length} 個欄位沒填：${esc(r.missing.join('、'))}</span>`);
    else if (placeholders(t.body).length) out.push('<span class="good">欄位都填好了</span>');
    if (t.kind === 'sms' && r.text.includes('暫停')) out.push('<span class="bad">內容有「暫停」兩字，三竹簡訊會發送失敗，請改寫</span>');
    return out.join('');
  }

  // ---------- 畫面：頁首 ----------
  function renderHeader() {
    const sel = $('#eventSelect');
    if (!state.events.length) {
      sel.innerHTML = '<option value="">尚未建立應變事件</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = state.events.map(e => `<option value="${esc(e.id)}">${esc(e.name)}（${fmt(e.createdAt).split(' ')[0]}${e.status === 'closed' ? '・已結束' : ''}）</option>`).join('') +
        '<option value="__browse">只瀏覽清單（不勾選）</option>';
      sel.value = state.eventId || '__browse';
    }
    const ev = state.event;
    $('#brandSub').textContent = ev ? `${ev.name}・目前階段：${PH[ev.currentPhase].name}${ev.status === 'closed' ? '（已結束）' : ''}` : '起士公爵・各部門應變步驟';
    const u = state.user;
    $('#userChip').innerHTML = u && u.name
      ? `<span class="avatar">${esc(u.name.slice(0, 1))}</span><span class="uname">${esc(u.name)}${DEPT[u.dept] ? '・' + esc(DEPT[u.dept].name) : ''}</span>`
      : '<span class="avatar">?</span><span class="uname">設定我的名字</span>';
    $('#userChip').setAttribute('aria-label', u && u.name ? `目前使用者：${u.name}，按這裡修改` : '設定我的名字');
    $$('.tabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    $('[data-act="event-new"]').hidden = !canManage();
    const ut = $('.tabs [data-view="users"]');
    if (ut) ut.hidden = !(Store.admin && Store.admin.enabled());
    renderSync();
    document.title = (ev ? ev.name + '｜' : '') + '颱風應變檢核清單';
  }

  // ---------- 畫面：沒有事件 ----------
  function viewEmpty() {
    const by = DATA.phases.map(p => `<div><b>${scopeItems('all', p.id).length}</b>${esc(p.name)}</div>`).join('');
    return `<section class="card empty">
      <h2>颱風要來了嗎？先建立一個應變事件</h2>
      <p>每次颱風建立一個事件，各部門在同一份清單上勾選，主管在「進度總覽」看誰還沒做完。清單內容來自《颱風應變措施》Excel，共 ${DATA.departments.length} 個部門、${DATA.items.length} 個步驟。</p>
      ${canManage() ? `<form data-form="quick-create" autocomplete="off">
        <label class="sr-only" for="quickName">颱風名稱</label>
        <input id="quickName" name="name" required maxlength="40" placeholder="颱風名稱，例：康芮颱風">
        <button class="btn btn-accent" type="submit">${icon('plus')}建立應變事件</button>
      </form>` : '<p style="margin-top:16px"><b>中央氣象署發布颱風警報時會自動建立；也可以請主管建立。</b></p>'}
      <div class="alt"><button type="button" class="link-btn" data-act="browse">先看看清單內容</button></div>
      <div class="stat-row">${by}</div>
    </section>`;
  }

  // ---------- 畫面：檢核清單 ----------
  function viewChecklist() {
    const ev = state.event;
    if (!ev && !state.browse) return viewEmpty();
    let html = '';
    if (!ev) {
      html += `<div class="banner browse">${icon('eye')}<span>瀏覽模式：可以看所有步驟，建立應變事件後才能勾選。</span>${canManage() ? `<button type="button" class="btn btn-sm btn-primary" data-act="event-new">${icon('plus')}建立應變事件</button>` : ''}</div>`;
    } else if (ev.status === 'closed') {
      html += `<div class="banner closed">${icon('lock')}<span>這個事件已在 ${fmt(ev.closedAt)} 由 ${esc(ev.closedBy || '')} 結束，清單只能查看。</span>${canManage() ? `<button type="button" class="btn btn-sm" data-act="event-reopen">${icon('unlock')}重新開啟</button>` : ''}</div>`;
    } else if (!canCheck()) {
      html += `<div class="banner closed">${icon('eye')}<span>你目前只能查看。需要勾選的話，請管理員在「人員與權限」幫你開「勾選與備註」。</span></div>`;
    }
    html += officialBannerHtml();
    html += phasebarHtml();
    html += filtersHtml();
    html += '<div id="list"></div>'; // render() 之後填入，這樣「顯示 N 項」才找得到位置
    return html;
  }

  function phasebarHtml() {
    const ev = state.event, cur = effPhase(), dept = effDept();
    const btns = DATA.phases.map(p => {
      const s = stats(scopeItems(dept, p.id));
      const now = ev && ev.currentPhase === p.id;
      return `<button type="button" class="phase p-${p.id}" data-act="phase" data-phase="${p.id}" aria-pressed="${cur === p.id}">
        <span class="ph-top"><span class="ph-num">${PH[p.id].n}</span><span class="ph-name">${esc(p.name)}</span>${now ? '<span class="now-tag">目前階段</span>' : ''}${ev ? `<span class="ph-count">${s.handled}/${s.total}</span>` : `<span class="ph-count">${s.total} 項</span>`}</span>
        <span class="ph-desc">${esc(p.desc)}</span>
        ${ev ? `<span class="bar p-${p.id}"><i style="width:${pct(s.handled, s.total)}%"></i></span>` : ''}
      </button>`;
    }).join('');
    return `<section class="phasebar" aria-label="階段">${btns}<button type="button" class="phase all" data-act="phase" data-phase="all" aria-pressed="${cur === 'all'}">全部階段</button></section>`;
  }

  function filtersHtml() {
    const ph = effPhase(), dept = effDept(), ev = state.event;
    const mine = state.user && state.user.dept;
    const chip = (id, name) => {
      const s = stats(scopeItems(id, ph));
      const full = ev && s.total && s.handled === s.total;
      return `<button type="button" class="chip${full ? ' full' : ''}" data-act="dept" data-dept="${id}" aria-pressed="${dept === id}">${esc(name)}${id === mine ? '<span class="mine">我的</span>' : ''}<span class="cnt">${ev ? `${s.handled}/${s.total}` : s.total}</span></button>`;
    };
    const chips = chip('all', '全部部門') + DATA.departments.map(d => chip(d.id, d.name)).join('');
    const seg = [['all', '全部'], ['todo', '未完成'], ['done', '已處理']].map(([v, l]) =>
      `<button type="button" data-act="show" data-show="${v}" aria-pressed="${state.show === v}"${!ev && v !== 'all' ? ' disabled' : ''}>${l}</button>`).join('');
    return `<section class="filters">
      <div class="chips" role="group" aria-label="部門">${chips}</div>
      <div class="toolrow">
        <label class="search"><span class="sr-only">搜尋</span>${icon('search')}<input id="q" type="search" placeholder="搜尋行動、說明、負責單位…" value="${esc(state.q)}" autocomplete="off"></label>
        <div class="seg" role="group" aria-label="顯示">${seg}</div>
        <span class="result-note" id="resultNote"></span>
      </div>
    </section>`;
  }

  function listHtml() {
    const items = filteredItems();
    const ph = effPhase(), dept = effDept();
    const note = $('#resultNote');
    const narrowed = ph !== 'all' || dept !== 'all';
    if (note) note.innerHTML = state.q ? `找到 ${items.length} 項${narrowed ? '・<button type="button" class="link-btn" data-act="search-all">改搜尋全部</button>' : ''}` : `顯示 ${items.length} 項`;
    if (!items.length) {
      let msg = '沒有符合的步驟。';
      if (state.show === 'todo' && !state.q) msg = '這個範圍的步驟都處理完了 👍';
      return `<div class="card no-result">${msg}${state.q && narrowed ? `<div><button type="button" class="link-btn" data-act="search-all">改在全部部門、全部階段搜尋「${esc(state.q)}」</button></div>` : ''}</div>`;
    }
    const phases = ph === 'all' ? DATA.phases.map(p => p.id) : [ph];
    const depts = dept === 'all' ? DATA.departments.map(d => d.id) : [dept];
    let html = '';
    phases.forEach(pid => {
      const inPhase = items.filter(i => i.phase === pid);
      if (!inPhase.length) return;
      let inner = '';
      depts.forEach(did => {
        const list = inPhase.filter(i => i.dept === did);
        if (!list.length) return;
        let body = '', lastGroup = null;
        list.forEach(i => {
          if (i.group && i.group !== lastGroup) {
            if (lastGroup !== null) body += '</div>';
            body += `<div class="group-label">${esc(i.group)}</div><div class="items">`;
            lastGroup = i.group;
          } else if (lastGroup === null) {
            body += '<div class="items">';
            lastGroup = '';
          }
          body += itemHtml(i);
        });
        body += '</div>';
        if (dept === 'all') {
          const s = stats(scopeItems(did, pid));
          inner += `<section class="dept-block"><h3 class="dept-head"><span class="code">${DEPT[did].code}</span>${esc(DEPT[did].name)}<span class="cnt">${state.event ? `${s.handled}/${s.total}` : `${s.total} 項`}</span></h3>${body}</section>`;
        } else {
          inner += `<section class="dept-block">${body}</section>`;
        }
      });
      html += ph === 'all'
        ? `<section class="phase-block"><div class="phase-head p-${pid}"><h2>${esc(PH[pid].name)}</h2><span class="muted">${esc(PH[pid].desc)}</span></div>${inner}</section>`
        : inner;
    });
    return html;
  }

  function descHtml(text) {
    return text.split(/\n?-{5,}\n?/).map(esc).join('<hr>');
  }

  function itemHtml(i) {
    const p = progressOf(i.id), ev = state.event, editable = canEdit();
    const d = DEPT[i.dept];
    const long = i.description.length > 120 || i.description.split('\n').length > 3;
    const open = !!state.expanded[i.id];
    const cls = p.status === 'done' ? ' is-done' : p.status === 'na' ? ' is-na' : '';
    const checkTitle = !ev ? '建立應變事件後才能勾選' : ev.status === 'closed' ? '事件已結束' : (p.status === 'done' ? '取消完成' : '標記完成');

    const meta = [];
    if (d.fields.deputy) meta.push(`<div><dt>代理人</dt><dd class="${i.deputy ? '' : 'unset'}">${esc(i.deputy || '未指定')}</dd></div>`);
    if (d.fields.linked && i.linked) meta.push(`<div><dt>連動單位</dt><dd>${esc(i.linked)}</dd></div>`);

    const acts = [];
    i.templateIds.forEach(tid => { const t = TPL[tid]; acts.push(`<button type="button" class="pill pill-tpl" data-act="tpl" data-tpl="${tid}" title="${esc(t.title)}">${icon('msg')}<span>${KIND[t.kind]}：${esc(shortTitle(t))}</span></button>`); });
    i.guideIds.forEach(gid => { acts.push(`<button type="button" class="pill" data-act="guide" data-guide="${gid}">${icon('doc')}<span>${esc(GUIDE[gid].title)}</span></button>`); });
    if (editable) {
      acts.push(`<button type="button" class="pill" data-act="note" data-id="${i.id}">${icon('note')}<span>${p.note ? '改備註' : '備註'}</span></button>`);
      acts.push(`<button type="button" class="pill" data-act="na" data-id="${i.id}" aria-pressed="${p.status === 'na'}">${icon('na')}<span>${p.status === 'na' ? '取消不適用' : '不適用'}</span></button>`);
    }

    let stamp = '';
    if (ev && p.status === 'done') stamp = `<div class="stamp">${icon('check')}已完成・${esc(p.by || '')}・${fmt(p.at)}</div>`;
    if (ev && p.status === 'na') stamp = `<div class="stamp na">${icon('na')}不適用・${esc(p.by || '')}・${fmt(p.at)}</div>`;

    let note = '';
    if (state.editingNote === i.id && editable) {
      note = `<div class="note-edit"><label class="sr-only" for="note-${i.id}">備註</label><textarea id="note-${i.id}" data-note-for="${i.id}" maxlength="500" placeholder="例：已發送 132 封，3 封失敗已改電聯">${esc(p.note || '')}</textarea>
        <div class="row"><button type="button" class="btn btn-sm btn-ghost" data-act="note-cancel">取消</button><button type="button" class="btn btn-sm btn-primary" data-act="note-save" data-id="${i.id}">儲存備註</button></div></div>`;
    } else if (p.note) {
      note = `<div class="note-view"><b>備註${p.noteBy ? `（${esc(p.noteBy)} ${fmt(p.noteAt)}）` : ''}</b>${esc(p.note)}</div>`;
    }

    return `<article class="item${cls}" data-item="${i.id}">
      <label class="check" title="${checkTitle}">
        <input type="checkbox" data-act="toggle" data-id="${i.id}" ${p.status === 'done' ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${esc(i.action)}：${checkTitle}">
        <span class="box">${CHECK_SVG}</span>
      </label>
      <div class="body">
        <div class="head"><h4 class="title"><span class="code">${i.id}</span>${esc(i.action)}</h4><span class="owner" title="負責">${esc(i.owner)}</span></div>
        ${i.description ? `<div class="desc${long && !open ? ' clamp' : ''}" id="desc-${i.id}">${descHtml(i.description)}</div>` : ''}
        ${long ? `<button type="button" class="more" data-act="expand" data-id="${i.id}" aria-expanded="${open}" aria-controls="desc-${i.id}">${open ? '收合說明' : '展開完整說明'}</button>` : ''}
        ${meta.length ? `<dl class="meta">${meta.join('')}</dl>` : ''}
        ${acts.length ? `<div class="item-actions">${acts.join('')}</div>` : ''}
        ${stamp}${note}
      </div>
    </article>`;
  }
  function shortTitle(t) { return t.title.replace(/（.*?）/g, '').trim() || t.title; }

  // ---------- 畫面：進度總覽 ----------
  function viewOverview() {
    const ev = state.event;
    if (!ev) {
      return `<section class="card empty"><h2>還沒有選擇應變事件</h2><p>建立或選擇一個應變事件後，這裡會顯示各部門、各階段的完成進度、還沒做的事和操作紀錄。</p>
        ${canManage() ? `<form data-form="quick-create" autocomplete="off"><label class="sr-only" for="quickName">颱風名稱</label><input id="quickName" name="name" required maxlength="40" placeholder="颱風名稱，例：康芮颱風"><button class="btn btn-accent" type="submit">${icon('plus')}建立應變事件</button></form>` : ''}</section>`
        + `<div style="margin-top:16px">${officialPanelHtml()}</div>`;
    }
    const all = stats(DATA.items);
    const curItems = scopeItems('all', ev.currentPhase);
    const cur = stats(curItems);
    const lastLog = ev.log[ev.log.length - 1];
    const closed = ev.status === 'closed';

    const head = `<section class="card ov-head">
      <div class="ttl">
        <h2>${esc(ev.name)}<span class="status-tag${closed ? ' closed' : ''}">${closed ? '已結束' : '進行中'}</span></h2>
        <p class="sub">${fmtFull(ev.createdAt)} 由 ${esc(ev.createdBy)} 建立${closed ? `・${fmtFull(ev.closedAt)} 由 ${esc(ev.closedBy || '')} 結束` : ''}</p>
        ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ''}
      </div>
      <div class="ov-actions">
        <button type="button" class="btn btn-sm" data-act="export">${icon('download')}匯出 CSV</button>
        ${canManage() ? `<button type="button" class="btn btn-sm" data-act="event-edit">${icon('edit')}編輯</button>
        ${closed ? `<button type="button" class="btn btn-sm" data-act="event-reopen">${icon('unlock')}重新開啟</button>` : `<button type="button" class="btn btn-sm" data-act="event-close">${icon('lock')}結束事件</button>`}
        <button type="button" class="btn btn-sm btn-danger" data-act="event-delete">${icon('trash')}刪除</button>` : ''}
      </div>
      <div class="phase-switch">
        <span class="lbl">目前階段（${canManage() ? '切換後，各部門的清單會預設顯示這個階段' : '由主管或官方公告切換'}）</span>
        <div class="seg" role="group" aria-label="目前階段">${DATA.phases.map(p => `<button type="button" class="p-${p.id}" data-act="set-phase" data-phase="${p.id}" aria-pressed="${ev.currentPhase === p.id}"${closed || !canManage() ? ' disabled' : ''}>${PH[p.id].n}. ${esc(p.name)}</button>`).join('')}</div>
      </div>
    </section>`;

    const kpis = `<section class="kpis">
      <div class="card kpi"><div class="k">整體進度</div><div class="v">${pct(all.handled, all.total)}<small>%</small></div><div class="bar"><i style="width:${pct(all.handled, all.total)}%"></i></div></div>
      <div class="card kpi"><div class="k">目前階段：${esc(PH[ev.currentPhase].name)}</div><div class="v">${cur.handled}<small>/ ${cur.total}</small></div><div class="bar p-${ev.currentPhase}"><i style="width:${pct(cur.handled, cur.total)}%"></i></div></div>
      <div class="card kpi"><div class="k">已完成</div><div class="v">${all.done}<small>項</small></div><div class="muted" style="font-size:13px">不適用 ${all.na} 項・未完成 ${all.total - all.handled} 項</div></div>
      <div class="card kpi"><div class="k">最後更新</div><div class="v" style="font-size:18px;margin-top:6px">${lastLog ? fmt(lastLog.at) : '—'}</div><div class="muted" style="font-size:13px">${lastLog ? esc(lastLog.by) : ''}</div></div>
    </section>`;

    const cell = (dept, ph) => {
      const s = stats(scopeItems(dept, ph));
      if (!s.total) return '<span class="cellbtn zero">—</span>';
      const full = s.handled === s.total;
      return `<button type="button" class="cellbtn${full ? ' full' : ''}" data-act="goto" data-dept="${dept}" data-phase="${ph}" title="查看清單"><span class="n"><b>${s.handled}</b> / ${s.total}${full ? ' ✓' : ''}</span><span class="bar${ph === 'all' ? '' : ' p-' + ph}"><i style="width:${pct(s.handled, s.total)}%"></i></span></button>`;
    };
    const rows = DATA.departments.map(d => `<tr><th scope="row">${esc(d.name)}</th>${DATA.phases.map(p => `<td>${cell(d.id, p.id)}</td>`).join('')}<td>${cell(d.id, 'all')}</td></tr>`).join('');
    const totalRow = `<tr><th scope="row">合計</th>${DATA.phases.map(p => `<td>${cell('all', p.id)}</td>`).join('')}<td>${cell('all', 'all')}</td></tr>`;
    const matrix = `<div class="section-title"><h2>各部門進度</h2><span class="muted" style="font-size:13px">點數字可以直接看那一格的清單</span></div>
      <div class="card matrix-wrap"><table class="matrix"><thead><tr><th scope="col">部門</th>${DATA.phases.map(p => `<th scope="col"${ev.currentPhase === p.id ? ' class="now"' : ''}>${esc(p.name)}</th>`).join('')}<th scope="col">合計</th></tr></thead><tbody>${rows}${totalRow}</tbody></table></div>`;

    // 目前階段還沒做的
    const todo = curItems.filter(i => statusOf(i.id) === 'todo');
    let todoHtml = '';
    if (!todo.length) {
      const next = DATA.phases[PH[ev.currentPhase].n];
      todoHtml = `<div class="all-done">${icon('check')}「${esc(PH[ev.currentPhase].name)}」的步驟都處理完了</div>${next && !closed && canManage() ? `<button type="button" class="btn btn-sm" data-act="set-phase" data-phase="${next.id}">切換到「${esc(next.name)}」</button>` : ''}`;
    } else {
      DATA.departments.forEach(d => {
        const list = todo.filter(i => i.dept === d.id);
        if (!list.length) return;
        todoHtml += `<div class="todo-group"><h4><span>${esc(d.name)}</span><span>${list.length} 項</span></h4><ul class="todo-list">${list.map(i =>
          `<li><span class="mono">${i.id}</span><button type="button" data-act="goto-item" data-id="${i.id}">${esc(i.action)}</button><span class="o">${esc(i.owner)}</span></li>`).join('')}</ul></div>`;
      });
    }
    const logs = ev.log.slice(-60).reverse().map(l => `<li><time datetime="${esc(l.at)}">${fmt(l.at)}</time><span><span class="who">${esc(l.by)}</span> ${logText(l)}</span></li>`).join('');

    return head + officialPanelHtml() + kpis + matrix + `<div class="two-col">
      <section class="card panel"><h3>「${esc(PH[ev.currentPhase].name)}」還沒做的（${todo.length}）</h3>${todoHtml}</section>
      <section class="card panel"><h3>操作紀錄</h3>${logs ? `<ul class="log">${logs}</ul>` : '<p class="muted">還沒有紀錄</p>'}</section>
    </div>`;
  }
  function logText(l) {
    const it = l.itemId && ITEM[l.itemId];
    const what = it ? `<span class="mono">${it.id}</span> ${esc(it.action)}` : esc(l.itemId || '');
    switch (l.type) {
      case 'event.create': return `建立事件「${esc(l.detail)}」`;
      case 'event.rename': return `把事件改名為「${esc(l.to)}」`;
      case 'event.phase': return `切換階段：${esc((PH[l.from] || {}).name || l.from)} → <b>${esc((PH[l.to] || {}).name || l.to)}</b>${l.detail ? `<br><span class="muted">${esc(l.detail)}</span>` : ''}`;
      case 'event.vars': return `自動帶入範本欄位：${esc(l.detail)}`;
      case 'event.close': return '結束事件';
      case 'event.reopen': return '重新開啟事件';
      case 'item.status':
        if (l.to === 'done') return `完成 ${what}`;
        if (l.to === 'na') return `標為不適用 ${what}`;
        return `${l.from === 'na' ? '取消不適用' : '取消完成'} ${what}`;
      case 'item.note': return `${l.detail ? '寫了備註' : '清除備註'} ${what}`;
      default: return esc(l.type);
    }
  }

  // ---------- 畫面：範本 ----------
  function tplCardHtml(t) {
    const vars = currentVars();
    const r = fill(t, vars);
    const fields = placeholders(t.body).map(k =>
      `<label>${esc(k)}<input data-var="${esc(k)}" value="${esc(vars[k] || '')}" placeholder="${esc(varHint(k))}" autocomplete="off"></label>`).join('');
    const links = t.itemIds.filter(id => ITEM[id]).map(id => `<button type="button" data-act="goto-item" data-id="${id}">${id} ${esc(ITEM[id].action)}</button>`).join('');
    const openOrig = !!state.openOriginals[t.id];
    return `<article class="card tpl" data-tpl-card="${t.id}">
      <div class="tpl-head"><span class="kind ${t.kind}">${KIND[t.kind]}</span><h3>${esc(t.title)}</h3><span class="ptag p-${t.phase}">${esc(PH[t.phase].name)}</span></div>
      ${t.usage ? `<p class="usage">${esc(t.usage)}</p>` : ''}
      ${t.audience ? `<p class="audience"><b>傳給：</b>${esc(t.audience)}</p>` : ''}
      ${fields ? `<div class="fields">${fields}</div>` : ''}
      <div class="preview" data-preview="${t.id}">${r.html}</div>
      <div class="checks" data-checks="${t.id}">${checksHtml(t, r)}</div>
      <div class="tpl-foot">
        <button type="button" class="btn btn-sm btn-primary" data-act="copy" data-tpl="${t.id}">${icon('copy')}複製內容</button>
        ${t.original && t.original !== t.body ? `<button type="button" class="btn btn-sm" data-act="orig" data-tpl="${t.id}" aria-expanded="${openOrig}">${openOrig ? '收起原始範例' : '看原始範例'}</button>` : ''}
        ${links ? `<div class="links">相關步驟：${links}</div>` : ''}
      </div>
      ${t.original && t.original !== t.body ? `<p class="original" data-orig="${t.id}"${openOrig ? '' : ' hidden'}>${esc(t.original)}</p>` : ''}
      ${t.sourceNotes && t.sourceNotes.length ? `<p class="muted" style="font-size:12.5px">原檔備註：${esc(t.sourceNotes.join('・'))}</p>` : ''}
      ${t.note ? `<p class="src-note">${esc(t.note)}</p>` : ''}
    </article>`;
  }
  function varHint(k) {
    const h = { '颱風名稱': '例：康芮颱風', '改期截止時間': '例：10/29 下午3點', '原定到貨日': '例：8/13(三)', '台南停班日': '例：8/13(三)',
      '停班日期': '例：8/13(三)', '最快到貨日': '例：8/15(五)', '受影響日期區間': '例：8/13～8/15', '顧客稱呼': '例：王小姐',
      '取貨門市': '例：東橋', '停班地區': '例：台北', '現有口味': '例：原味、巧克力' };
    return h[k] || '';
  }
  function viewTemplates() {
    const ev = state.event;
    const groups = [
      ['sms', '給顧客的簡訊', '客服群發前，先發一封測試、成功後再群發，發完確認有沒有異常。'],
      ['script', '門市電話話術', ''],
      ['message', '通路部對內／對廠商訊息', '']
    ];
    let html = `<div class="card tpl-intro">在欄位填入這次的資料，下面的內容會跟著換掉，按「複製內容」貼到簡訊平台或 LINE。<b>${ev ? `填的值會存在「${esc(ev.name)}」事件裡，其他人打開也看得到。` : '目前沒有選擇事件，填的值不會儲存。'}</b>同名欄位（例如颱風名稱）只要填一次。</div>`;
    groups.forEach(([kind, title, sub]) => {
      const list = DATA.templates.filter(t => t.kind === kind);
      if (!list.length) return;
      html += `<section class="tpl-section"><div class="section-title"><h2>${title}</h2>${sub ? `<span class="muted" style="font-size:13px">${esc(sub)}</span>` : ''}</div><div class="tpl-grid">${list.map(tplCardHtml).join('')}</div></section>`;
    });
    if (DATA.guides.length) {
      html += `<section class="tpl-section"><div class="section-title"><h2>操作說明</h2></div><div class="tpl-grid">${DATA.guides.map(g =>
        `<article class="card tpl"><div class="tpl-head"><span class="kind guide">說明</span><h3>${esc(g.title)}</h3></div><div class="guide-body">${esc(g.body)}</div></article>`).join('')}</div></section>`;
    }
    return html;
  }

  // ---------- 整頁重畫（保留焦點） ----------
  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.id === 'q') return { sel: '#q', caret: el.selectionStart };
    if (el.dataset && el.dataset.var) return { sel: `[data-var="${CSS.escape(el.dataset.var)}"]`, caret: el.selectionStart, inDlg: !!el.closest('dialog') };
    if (el.dataset && el.dataset.act) {
      const parts = ['act', 'id', 'tpl', 'phase', 'dept', 'show', 'guide'].filter(k => el.dataset[k]).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`);
      return { sel: parts.join(''), inDlg: !!el.closest('dialog') };
    }
    return null;
  }
  function render() {
    const fk = focusKey(document.activeElement);
    state.offEval = state.official && Official ? Official.evaluate(state.official, state.settings, state.event) : null; // 依目前選的事件重算
    renderHeader();
    const main = $('#main');
    if (state.view === 'users' && !(Store.admin && Store.admin.enabled())) state.view = 'checklist';
    main.innerHTML = state.view === 'users' ? viewUsers() : state.view === 'overview' ? viewOverview() : state.view === 'templates' ? viewTemplates() : viewChecklist();
    if (state.view === 'checklist' && $('#list')) $('#list').innerHTML = listHtml(); // 更新「顯示 N 項」
    if (fk && !fk.inDlg) {
      const el = $(fk.sel);
      if (el) { el.focus({ preventScroll: true }); if (fk.caret != null && el.setSelectionRange) try { el.setSelectionRange(fk.caret, fk.caret); } catch (e) { /* type=search 某些瀏覽器不支援 */ } }
    }
    saveUi();
  }
  function renderList() { const el = $('#list'); if (el) el.innerHTML = listHtml(); }

  // ---------- 對話框 ----------
  const dlg = $('#dlg');
  let dlgHandlers = {};
  function openDialog({ title, body, foot, wide, onSubmit, onClose }) {
    dlg.className = wide ? 'wide' : '';
    dlg.innerHTML = `<form class="dlg" method="dialog" novalidate>
      <div class="dlg-head"><h2 id="dlgTitle">${title}</h2><button type="button" class="x" data-act="close-dlg" aria-label="關閉">${icon('x')}</button></div>
      <div class="dlg-body">${body}</div>
      ${foot ? `<div class="dlg-foot">${foot}</div>` : ''}
    </form>`;
    dlgHandlers = { onSubmit, onClose };
    if (!dlg.open) dlg.showModal();
    const first = $('input:not([type=hidden]),select,textarea', dlg);
    if (first) first.focus();
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { const h = dlgHandlers.onClose; dlgHandlers = {}; dlg.innerHTML = ''; if (h) h(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); }); // 點背景關閉
  dlg.addEventListener('submit', async e => {
    e.preventDefault();
    if (!dlgHandlers.onSubmit) return closeDialog();
    const ok = await dlgHandlers.onSubmit(new FormData(e.target), e.target);
    if (ok !== false) closeDialog();
  });
  function confirmDialog({ title, message, okText, danger }) {
    return new Promise(resolve => {
      let result = false;
      openDialog({
        title: esc(title), body: `<p>${message}</p>`,
        foot: `<button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(okText || '確定')}</button>`,
        onSubmit: () => { result = true; },
        onClose: () => resolve(result)
      });
    });
  }

  function openUserDialog(reason) {
    return new Promise(resolve => {
      let saved = null;
      const u = state.user || {};
      const perms = isCloud ? PERMS.filter(([k]) => Store.can(k)).map(([, l]) => l) : [];
      openDialog({
        title: isCloud ? '我的帳號' : '我是誰',
        body: `${reason ? `<p class="muted">${esc(reason)}</p>` : ''}<div class="form">
          ${isCloud
            ? `<label>名字<input name="name" value="${esc(u.name || '')}" readonly><span class="hint">Google 登入：${esc(u.email || '')}。名字由管理員在「人員與權限」設定。權限：${perms.length ? esc(perms.join('、')) : '只能查看'}</span></label>`
            : `<label>名字<input name="name" required maxlength="20" value="${esc(u.name || '')}" placeholder="例：王小明" autocomplete="name"><span class="hint">勾選時會記錄是誰、什麼時間完成的。</span></label>`}
          <label>部門<select name="dept"><option value="">（不指定）</option>${DATA.departments.map(d => `<option value="${d.id}"${u.dept === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select><span class="hint">打開清單時會先顯示這個部門。</span></label>
          <p class="err" data-err></p></div>`,
        foot: (isCloud ? '<button type="button" class="btn btn-danger" data-act="logout">登出</button><span style="flex:1"></span>' : '') +
          '<button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn btn-primary">儲存</button>',
        onSubmit: async fd => {
          const name = String(fd.get('name') || '').trim();
          if (!name) { $('[data-err]', dlg).textContent = '請輸入名字'; return false; }
          const dept = String(fd.get('dept') || '');
          const prevDept = state.user && state.user.dept;
          state.user = await Store.setUser({ name, dept });
          if (!state.dept || state.dept === prevDept) state.dept = dept || 'all';
          saved = state.user;
        },
        onClose: () => { render(); resolve(saved); }
      });
    });
  }
  async function ensureUser() {
    if (state.user && state.user.name) return true;
    if (isCloud) return true; // 雲端版：名字來自 Google 登入
    if (!Store.setUser) { toast('讀不到登入身分，請重新登入', { warn: true }); return false; } // 接上公司登入後不會走到這裡
    return !!(await openUserDialog('第一次使用，請先留下名字。'));
  }

  function openEventDialog(ev) {
    const editing = !!ev;
    openDialog({
      title: editing ? '編輯應變事件' : '新增應變事件',
      body: `<div class="form">
        <label>颱風名稱<input name="name" required maxlength="40" value="${esc(ev ? ev.name : '')}" placeholder="例：康芮颱風"><span class="hint">簡訊範本的「颱風名稱」會自動帶入。</span></label>
        <label>備註（選填）<textarea name="note" maxlength="500" placeholder="例：預計週三晚間登陸，台南可能停班">${esc(ev ? ev.note : '')}</textarea></label>
        <p class="err" data-err></p></div>`,
      foot: `<button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn btn-accent">${editing ? '儲存' : '建立'}</button>`,
      onSubmit: async fd => {
        const name = String(fd.get('name') || '').trim();
        if (!name) { $('[data-err]', dlg).textContent = '請輸入颱風名稱'; return false; }
        try {
          if (editing) {
            state.event = await Store.updateEvent(ev.id, { name, note: String(fd.get('note') || '') });
            await loadEvents();
            toast('已儲存');
          } else {
            await createEvent(name, String(fd.get('note') || ''));
          }
        } catch (err) { $('[data-err]', dlg).textContent = err.message; return false; }
      },
      onClose: () => render()
    });
  }
  async function createEvent(name, note) {
    await ensureUser();
    const ev = await Store.createEvent({ name, note });
    state.eventId = ev.id; state.browse = false; state.phase = 'current'; state.show = 'all'; state.q = '';
    state.view = 'checklist';
    await loadEvents();
    render();
    toast(`已建立「${ev.name}」，各部門可以開始勾選`);
  }

  function openTemplateDialog(tid) {
    const t = TPL[tid];
    const title = t.kind === 'sms' ? '簡訊範本' : t.kind === 'script' ? '電話話術' : '訊息範本';
    openDialog({ title, body: tplCardHtml(t), wide: true, onClose: () => { if (state.view === 'templates') render(); } });
  }
  function openGuideDialog(gid) {
    const g = GUIDE[gid];
    openDialog({ title: esc(g.title), body: `<div class="guide-body">${esc(g.body)}</div>`, wide: true,
      foot: '<button type="button" class="btn" data-act="close-dlg">關閉</button>' });
  }

  // ---------- 提示 ----------
  let toastTimer = null;
  function toast(msg, opts) {
    const el = $('#toast');
    el.className = 'toast show' + (opts && opts.warn ? ' warn' : '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, (opts && opts.ms) || 2600);
  }

  // ---------- 動作 ----------
  async function setStatus(id, status, extra) {
    if (!canEdit()) return;
    if (!(await ensureUser())) { render(); return; }
    try {
      state.event = await Store.setItemStatus(state.eventId, id, Object.assign({ status }, extra || {}));
    } catch (err) { toast(err.message, { warn: true }); }
    render();
    const it = ITEM[id];
    if (status === 'done') toast(`完成：${it.action}`);
    else if (status === 'na') toast(`標為不適用：${it.action}`);
  }
  async function saveNote(id) {
    const ta = $(`[data-note-for="${CSS.escape(id)}"]`);
    if (!ta) return;
    if (!(await ensureUser())) return;
    try { state.event = await Store.setItemStatus(state.eventId, id, { note: ta.value }); }
    catch (err) { toast(err.message, { warn: true }); return; }
    state.editingNote = null;
    render();
    toast('備註已儲存');
  }
  function gotoItem(id) {
    const it = ITEM[id];
    closeDialog();
    state.view = 'checklist'; state.dept = it.dept; state.phase = it.phase; state.show = 'all'; state.q = '';
    render();
    const el = $(`[data-item="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    }
  }
  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    const ev = state.event;
    if (!ev) return;
    const rows = [['編號', '部門', '階段', '分組', '行動', '負責單位', '代理人', '狀態', '處理人', '處理時間', '備註', '備註人', '備註時間']];
    DATA.items.forEach(i => {
      const p = progressOf(i.id);
      rows.push([i.id, DEPT[i.dept].name, PH[i.phase].name, i.group, i.action, i.owner, i.deputy, STATUS[p.status],
        p.status !== 'todo' ? p.by : '', p.status !== 'todo' ? fmtFull(p.at) : '', p.note, p.note ? p.noteBy : '', p.note ? fmtFull(p.noteAt) : '']);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const d = new Date();
    const name = `颱風應變進度_${ev.name}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`.replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已匯出 ' + name);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      (dlg.open ? dlg : document.body).appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // 範本欄位：打字時只更新預覽，停下來 0.6 秒後才存
  let varTimer = null;
  const pendingVars = {};
  function onVarInput(input) {
    const k = input.dataset.var, v = input.value;
    if (state.event && canCheck()) { state.event.vars[k] = v; pendingVars[k] = v; }
    else state.vars[k] = v;
    $$('[data-var]').forEach(el => { if (el !== input && el.dataset.var === k) el.value = v; });
    const vars = currentVars();
    $$('[data-tpl-card]').forEach(card => {
      const t = TPL[card.dataset.tplCard];
      if (!placeholders(t.body).includes(k)) return;
      const r = fill(t, vars);
      $('[data-preview]', card).innerHTML = r.html;
      $('[data-checks]', card).innerHTML = checksHtml(t, r);
    });
    if (state.event) {
      clearTimeout(varTimer);
      varTimer = setTimeout(flushVars, 600);
    }
  }
  async function flushVars() {
    clearTimeout(varTimer);
    const keys = Object.keys(pendingVars);
    if (!keys.length || !state.event) return;
    const patch = {};
    keys.forEach(k => { patch[k] = pendingVars[k]; delete pendingVars[k]; });
    try { state.event = await Store.updateEvent(state.eventId, { vars: patch }); }
    catch (err) { toast('欄位沒有存到：' + err.message, { warn: true }); }
  }

  // ---------- 雲端同步狀態 ----------
  const SYNC_LABEL = { loading: '讀取中', syncing: '同步中', pending: '等待上傳', synced: '已同步', offline: '離線', error: '連線失敗' };
  function renderSync() {
    const el = $('#syncPill');
    if (!el) return;
    if (!Store.sync) { el.hidden = true; return; }
    const st = Store.sync.status();
    el.hidden = false;
    el.className = 'sync-pill s-' + st.state;
    el.innerHTML = `<i></i><span>${SYNC_LABEL[st.state] || st.state}</span>`;
    el.title = (st.detail ? st.detail + '。' : '') + (st.lastSync ? `上次同步 ${fmt(new Date(st.lastSync).toISOString())}。` : '') + '按這裡立即同步';
  }

  // ---------- 人員與權限（雲端版、管理員）----------
  const PERMS = [['check', '勾選與備註', '勾選步驟、標不適用、寫備註、填範本欄位'], ['manage', '管理事件', '建立／結束／刪除事件、切換階段、官方公告連動設定']];
  const U = { list: null, admins: [], error: '', loading: false };
  async function loadUsers() {
    if (U.loading || !Store.admin) return;
    U.loading = true;
    try { const j = await Store.admin.list(); U.list = j.users || []; U.admins = j.admins || []; U.error = ''; }
    catch (e) { U.error = e.message; }
    U.loading = false;
    if (state.view === 'users') render();
  }
  async function userCall(fn, okMsg) {
    try { const j = await fn(); U.list = j.users || U.list; render(); toast(okMsg); }
    catch (e) { toast(e.message, { warn: true }); }
  }
  function viewUsers() {
    if (!U.list && !U.error) { loadUsers(); return '<section class="card empty"><p>正在讀取人員名單…</p></section>'; }
    if (U.error) return `<section class="card empty"><h2>讀不到人員名單</h2><p>${esc(U.error)}</p><div class="alt"><button type="button" class="btn" data-act="users-reload">重試</button></div></section>`;
    const permText = pages => PERMS.filter(([k]) => (pages || []).includes(k)).map(([, l]) => l).join('、') || '只能查看';
    const rows = U.list.map(u => `<tr class="${u.enabled ? '' : 'off'}">
      <th scope="row"><b>${esc(u.name || '（未填名字）')}</b><div class="muted mono">${esc(u.email)}</div></th>
      <td>${esc(permText(u.pages))}</td>
      <td>${u.enabled ? '<span class="st st-normal">啟用</span>' : '<span class="st st-closed">停用</span>'}</td>
      <td class="muted">${u.lastLogin ? fmt(new Date(u.lastLogin).toISOString()) : '還沒登入'}</td>
      <td class="u-act"><button type="button" class="btn btn-sm" data-act="user-edit" data-id="${esc(u.email)}">${icon('edit')}編輯</button>
        <button type="button" class="btn btn-sm" data-act="user-toggle" data-id="${esc(u.email)}">${u.enabled ? '停用' : '啟用'}</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="user-delete" data-id="${esc(u.email)}" aria-label="刪除 ${esc(u.email)}">${icon('trash')}</button></td>
    </tr>`).join('');
    return `<section class="card panel">
      <div class="op-head"><h3>人員與權限</h3><button type="button" class="btn btn-primary btn-sm" data-act="user-add">${icon('plus')}新增人員</button></div>
      <p class="muted" style="font-size:14px">只有名單內的 Gmail 能登入。管理員（${esc(U.admins.join('、'))}）有全部權限，在雲端後端 Code.gs 設定。
        新增後把網址傳給對方，請他用這個 Gmail 登入。</p>
      ${U.list.length ? `<div class="matrix-wrap"><table class="matrix users-table"><thead><tr><th scope="col">人員</th><th scope="col">權限</th><th scope="col">狀態</th><th scope="col">最後登入</th><th scope="col"><span class="sr-only">動作</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="no-result">還沒有其他人員。按「新增人員」加入同事的 Gmail。</p>'}
      <p class="muted" style="font-size:13px">權限：${PERMS.map(([, l, h]) => `<b>${l}</b>＝${h}`).join('；')}。都不勾＝只能查看。</p>
    </section>`;
  }
  function openPersonDialog(u) {
    const editing = !!u;
    const pages = u ? u.pages || [] : ['check'];
    openDialog({
      title: editing ? '編輯人員' : '新增人員',
      body: `<div class="form">
        <label>Gmail<input name="email" type="email" required maxlength="120" value="${esc(u ? u.email : '')}" ${editing ? 'readonly' : ''} placeholder="例：someone@gmail.com" autocomplete="off"></label>
        <label>名字<input name="name" maxlength="30" value="${esc(u ? u.name : '')}" placeholder="例：王店長（勾選紀錄會顯示這個名字）"></label>
        <fieldset class="county-grid perm-grid"><legend>權限</legend>
          ${PERMS.map(([k, l, h]) => `<label class="ck-row"><input type="checkbox" name="p" value="${k}"${pages.includes(k) ? ' checked' : ''}><span>${l}<span class="hint">${h}</span></span></label>`).join('')}
        </fieldset>
        <p class="err" data-err></p></div>`,
      foot: '<button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn btn-primary">儲存</button>',
      onSubmit: async fd => {
        const email = String(fd.get('email') || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('[data-err]', dlg).textContent = 'Gmail 地址格式不對'; return false; }
        try {
          const j = await Store.admin.save({ email, name: String(fd.get('name') || '').trim(), pages: fd.getAll('p').map(String), enabled: u ? u.enabled : true });
          U.list = j.users || U.list;
          toast(editing ? '已更新' : `已加入 ${email}，請他用這個 Gmail 登入`);
        } catch (e) { $('[data-err]', dlg).textContent = e.message; return false; }
      },
      onClose: () => render()
    });
  }

  // ---------- 官方公告連動 ----------
  // 抓公告 → 依規則（official.js）自動建立事件、切換階段、帶入範本欄位。
  // 正式環境建議由後端排程做（Store.serverRules = true），畫面只顯示，避免每台裝置各自建立事件。
  // 同時有好幾個地方要求更新時排隊執行（不能直接略過，否則呼叫的人以為已經更新完了）
  let syncChain = Promise.resolve();
  let officialMsgs = [];
  function syncOfficial() {
    syncChain = syncChain.then(doSyncOfficial, doSyncOfficial);
    return syncChain;
  }
  async function doSyncOfficial() {
    if (!Official) return [];
    officialMsgs = [];
    let off = null;
    try { off = await Store.getOfficialStatus(); } catch (e) { off = null; }
    state.official = off;
    try { if (off && !Store.serverRules) await applyOfficial(off); }
    catch (e) { toast('依官方公告調整失敗：' + e.message, { warn: true }); }
    state.offEval = off ? Official.evaluate(off, state.settings, state.event) : null;
    return officialMsgs;
  }
  function officialToast(msg) { officialMsgs.push(msg); toast(msg, { ms: 5000 }); }
  async function applyOfficial(off) {
    const s = state.settings;
    let r = Official.evaluate(off, s, null);
    let target = Official.matchEvent(state.events, r.typhoon);
    if (!target && r.createEvent) {
      const created = await Store.createEvent({ name: r.createEvent.name, typhoon: r.createEvent.typhoon, actor: SYSTEM,
        note: `中央氣象署發布${r.typhoon.headline}，系統自動建立。` });
      if (!state.eventId && !state.browse) { state.eventId = created.id; state.phase = 'current'; }
      await loadEvents();
      target = created;
      if (!created.existed) officialToast(`中央氣象署發布${r.typhoon.headline}，已自動建立「${created.name}」`);
    }
    if (!target) return;
    const full = target.id === state.eventId && state.event ? state.event : await Store.getEvent(target.id);
    if (!full) return;
    r = Official.evaluate(off, s, full);
    const plan = Official.planAutoUpdate(full, r, s);
    if (!plan) return;
    const updated = await Store.applyAuto(full.id, plan);
    if (updated.id === state.eventId) { state.event = updated; if (plan.currentPhase) state.phase = 'current'; }
    await loadEvents();
    if (plan.currentPhase) officialToast(`依官方公告切換到「${PH[plan.currentPhase].name}」：${r.reason}`);
  }
  function watchedList() {
    const s = state.settings;
    const list = [s.hqCounty].concat(s.watchedCounties || []);
    return list.filter((c, i) => c && list.indexOf(c) === i);
  }
  const CLOSE_LABEL = { closed: '停止上班', partial: '部分地區停班', normal: '照常上班' };
  function officialBannerHtml() {
    const off = state.official, r = state.offEval;
    if (!off || !r) return '';
    const ev = state.event;
    const lines = r.summary.length ? r.summary : ['目前沒有颱風警報'];
    let suggest = '';
    if (ev && ev.status !== 'closed' && canManage() && r.phase && Official.isForward(ev.currentPhase, r.phase) && (!state.settings.autoAdjust || Store.serverRules)) {
      suggest = `<button type="button" class="btn btn-sm btn-primary" data-act="set-phase" data-phase="${r.phase}">切換到「${esc(PH[r.phase].name)}」</button>`;
    }
    const dept = effDept();
    const scen = r.scenario && (dept === 'all' || dept === 'production')
      ? `<div class="off-scen">生產部用情境 <b>${r.scenario}</b>：${r.scenario === 'A' ? `${esc(state.settings.hqCounty)}停班，總公司停工` : '只有外縣市停班，總公司照常生產，黑貓停配區域降產或調整出貨順序'}</div>` : '';
    const cls = r.closures.length ? ' is-closed' : r.warningActive ? ' is-warn' : '';
    return `<section class="official${cls}" aria-label="官方公告">
      <span class="off-icon">${icon('storm')}</span>
      <div class="off-body">
        <div class="off-title">官方公告${off.source === 'simulated' ? '<span class="sim-tag">測試模式・模擬資料</span>' : ''}</div>
        ${lines.map(l => `<div class="off-line">${esc(l)}</div>`).join('')}
        ${scen}
        <div class="off-meta">${fmt(off.fetchedAt)} 更新・${state.settings.autoAdjust && !Store.serverRules ? '依公告自動調整階段' : Store.serverRules ? '由系統排程自動調整' : '自動調整已關閉'}${suggest ? `・建議進入「${esc(PH[r.phase].name)}」` : ''}</div>
      </div>
      <div class="off-act">${suggest}<button type="button" class="btn btn-sm btn-ghost" data-act="goto-official">詳情</button></div>
    </section>`;
  }
  function officialPanelHtml() {
    const off = state.official, r = state.offEval, s = state.settings;
    const btns = `<div class="ov-actions">
      <button type="button" class="btn btn-sm" data-act="official-refresh">${icon('refresh')}立即更新</button>
      ${canManage() ? `<button type="button" class="btn btn-sm" data-act="official-settings">${icon('gear')}連動設定</button>` : ''}
      ${Store.setSimulatedOfficial && canManage() ? `<button type="button" class="btn btn-sm" data-act="official-sim">${icon('flask')}測試模式</button>` : ''}</div>`;
    const conf = `<p class="op-conf">總公司：<b>${esc(s.hqCounty)}</b>・關注縣市：${esc(watchedList().join('、'))}・自動切換階段：${s.autoAdjust ? '開' : '關'}・颱風警報自動建立事件：${s.autoCreate ? '開' : '關'}</p>`;
    if (!off || !r) {
      return `<section class="card panel official-panel" id="official"><div class="op-head"><h3>${icon('storm')}官方公告連動</h3>${btns}</div>
        <p class="muted">還沒有接上官方公告。正式上線後，系統會定時抓<b>中央氣象署颱風警報</b>與<b>人事行政總處停班停課公告</b>：發布警報時自動建立應變事件、關注的縣市停班時切到「停班期間」、警報解除且恢復上班時切到「恢復營運」，並自動帶入簡訊的颱風名稱與停班日期。現在可以按「測試模式」用模擬公告試試看。</p>${conf}</section>`;
    }
    const t = r.typhoon;
    const typhoon = t
      ? `<div class="op-row"><span class="op-k">中央氣象署</span><span><b>${esc(Official.typhoonLabel(t.name))}</b>${t.number ? `（第 ${esc(t.number)} 號${t.intlName ? `，${esc(t.intlName)}` : ''}）` : ''}・${esc(t.warningType === 'lifted' ? '解除颱風警報' : t.headline)}${t.reportNo ? ` 第 ${esc(t.reportNo)} 報` : ''}${t.expires && t.warningType !== 'lifted' ? `・有效到 ${fmt(t.expires)}` : ''}${t.web ? `・<a href="${esc(t.web)}" target="_blank" rel="noopener">氣象署公告</a>` : ''}</span></div>`
      : `<div class="op-row"><span class="op-k">中央氣象署</span><span>目前沒有颱風警報</span></div>`;
    const cl = off.closures;
    const byCounty = {};
    ((cl && cl.counties) || []).forEach(c => { byCounty[c.county] = c; });
    const cell = v => v ? `<span class="st st-${v}">${CLOSE_LABEL[v]}</span>` : `<span class="muted">${cl && cl.empty ? '照常' : '—'}</span>`;
    const rows = watchedList().map(c => {
      const x = byCounty[c] || {};
      return `<tr><th scope="row">${esc(c)}${c === s.hqCounty ? '<span class="hq">總公司</span>' : ''}</th><td>${cell(x.today)}</td><td>${cell(x.tomorrow)}</td><td class="op-text">${esc(x.text || (cl && cl.empty ? '無停班停課訊息' : ''))}</td></tr>`;
    }).join('');
    const next = r.phase ? `<p class="op-next">依公告應在「<b>${esc(PH[r.phase].name)}</b>」${r.reason ? `：${esc(r.reason)}` : ''}${r.scenario ? `・生產部情境 ${r.scenario}` : ''}</p>` : '';
    const errs = (off.errors || []).length ? `<p class="src-note">讀取問題：${esc(off.errors.join('；'))}</p>` : '';
    return `<section class="card panel official-panel" id="official">
      <div class="op-head"><h3>${icon('storm')}官方公告連動${off.source === 'simulated' ? '<span class="sim-tag">測試模式・模擬資料</span>' : ''}</h3>${btns}</div>
      ${typhoon}
      <div class="op-row"><span class="op-k">人事行政總處</span><span>${cl ? `停班停課公告${cl.updatedAt ? `（${fmt(cl.updatedAt)} 更新）` : ''}・<a href="https://www.dgpa.gov.tw/typh/daily/nds.html" target="_blank" rel="noopener">總處公告頁</a>` : '讀取不到'}</span></div>
      ${cl ? `<div class="matrix-wrap"><table class="matrix op-table"><thead><tr><th scope="col">縣市</th><th scope="col">今天</th><th scope="col">明天</th><th scope="col">公告內容</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      ${next}${conf}${errs}
      <p class="muted op-src">${fmtFull(off.fetchedAt)} 抓取</p>
    </section>`;
  }

  function openOfficialSettings() {
    const s = state.settings;
    const C = Official.COUNTIES;
    openDialog({
      title: '官方公告連動設定', wide: true,
      body: `<div class="form">
        <label>總公司所在縣市<select name="hq">${C.map(c => `<option${c === s.hqCounty ? ' selected' : ''}>${c}</option>`).join('')}</select><span class="hint">這個縣市停班＝生產部情境 A（總公司停工），也會帶入簡訊的「台南停班日」。</span></label>
        <fieldset class="county-grid"><legend>關注的縣市<span class="hint">門市、物流、主要客戶所在地。這些縣市任何一個停班，就切到「停班期間」。</span></legend>
          ${C.map(c => `<label class="ck"><input type="checkbox" name="w" value="${c}"${(s.watchedCounties || []).includes(c) || c === s.hqCounty ? ' checked' : ''}>${c}</label>`).join('')}
        </fieldset>
        <label class="ck-row"><input type="checkbox" name="autoAdjust"${s.autoAdjust ? ' checked' : ''}><span>依公告自動切換階段<span class="hint">關掉的話只會顯示建議，由主管自己按切換。</span></span></label>
        <label class="ck-row"><input type="checkbox" name="autoCreate"${s.autoCreate ? ' checked' : ''}><span>中央氣象署發布颱風警報時，自動建立應變事件</span></label>
      </div>`,
      foot: '<button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn btn-primary">儲存</button>',
      onSubmit: async fd => {
        const hq = String(fd.get('hq'));
        const w = fd.getAll('w').map(String);
        if (!w.includes(hq)) w.unshift(hq);
        state.settings = await Store.saveSettings({ hqCounty: hq, watchedCounties: w, autoAdjust: fd.get('autoAdjust') === 'on', autoCreate: fd.get('autoCreate') === 'on' });
        const msgs = await syncOfficial();
        render();
        toast(msgs.length ? '連動設定已儲存；' + msgs.join('；') : '連動設定已儲存', { ms: msgs.length ? 5000 : 2600 });
      },
      onClose: () => render()
    });
  }

  function openSimDialog() {
    const sim = state.official && state.official.source === 'simulated' ? state.official : null;
    const t = (sim && sim.typhoon) || {};
    const today = new Date();
    const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const cur = {};
    ((sim && sim.closures && sim.closures.counties) || []).forEach(c => { cur[c.county] = c; });
    const opts = v => [['', '未公告'], ['normal', '照常上班'], ['closed', '停止上班'], ['partial', '部分地區停班']]
      .map(([k, l]) => `<option value="${k}"${(v || '') === k ? ' selected' : ''}>${l}</option>`).join('');
    const rows = watchedList().map(c => `<tr><th scope="row">${esc(c)}</th>
      <td><select name="d0:${esc(c)}" aria-label="${esc(c)}今天">${opts(cur[c] && cur[c].today)}</select></td>
      <td><select name="d1:${esc(c)}" aria-label="${esc(c)}明天">${opts(cur[c] && cur[c].tomorrow)}</select></td></tr>`).join('');
    const wt = sim ? (t.warningType || '') : 'sea';
    openDialog({
      title: '測試模式：模擬官方公告', wide: true,
      body: `<p class="muted">用模擬的公告取代真的公告，確認 App 會怎麼自動調整（只影響這台裝置）。測完按「清除模擬」回到真的公告。</p>
        <div class="form sim-grid">
          <label>颱風名稱<input name="tname" value="${esc(t.name || '沙德爾')}" maxlength="10"></label>
          <label>颱風編號<input name="tno" value="${esc(t.number || '18')}" maxlength="4" inputmode="numeric"></label>
          <label>中央氣象署<select name="wtype">
            ${[['', '沒有颱風警報'], ['sea', '海上颱風警報'], ['sea_land', '海上陸上颱風警報'], ['land', '陸上颱風警報'], ['lifted', '解除颱風警報']].map(([k, l]) => `<option value="${k}"${wt === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label>公告日期<input type="date" name="date" value="${esc((sim && sim.closures && sim.closures.date) || ymd)}"></label>
        </div>
        <div class="matrix-wrap"><table class="matrix sim-table"><thead><tr><th scope="col">人事行政總處</th><th scope="col">今天</th><th scope="col">明天</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted" style="font-size:13px">只列出關注的縣市；要模擬其他縣市，先到「連動設定」勾選。</p>`,
      foot: `<button type="button" class="btn btn-danger" data-act="sim-clear"${sim ? '' : ' disabled'}>清除模擬</button><span style="flex:1"></span><button type="button" class="btn" data-act="close-dlg">取消</button><button type="submit" class="btn btn-primary">套用模擬公告</button>`,
      onSubmit: async fd => {
        const name = String(fd.get('tname') || '').trim();
        const type = String(fd.get('wtype') || '');
        const headline = { sea: '海上颱風警報', sea_land: '海上陸上颱風警報', land: '陸上颱風警報', lifted: '解除颱風警報' }[type] || '';
        const nowIso = new Date().toISOString();
        const textOf = (day, v) => v === 'closed' ? `${day}停止上班、停止上課。` : v === 'partial' ? `部分地區${day}停止上班、停止上課。其餘地區照常上班、照常上課。` : v === 'normal' ? `${day}照常上班、照常上課。` : '';
        const counties = watchedList().map(c => {
          const d0 = String(fd.get('d0:' + c) || ''), d1 = String(fd.get('d1:' + c) || '');
          return { county: c, today: d0 || null, tomorrow: d1 || null, text: [textOf('今天', d0), textOf('明天', d1)].filter(Boolean).join('\n') };
        }).filter(c => c.today || c.tomorrow);
        const status = {
          fetchedAt: nowIso,
          typhoon: type && name ? { name, intlName: '', number: String(fd.get('tno') || ''), warningType: type, headline, reportNo: '',
            status: 'Actual', msgType: type === 'lifted' ? 'Cancel' : 'Alert', sent: nowIso, effective: nowIso,
            expires: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), web: 'https://www.cwa.gov.tw/V8/C/P/Warning/FIFOWS.html' } : null,
          closures: { date: String(fd.get('date') || ymd), updatedAt: nowIso, counties, empty: !counties.length }
        };
        await Store.setSimulatedOfficial(status);
        const msgs = await syncOfficial();
        render();
        toast(msgs.length ? msgs.join('；') : '已套用模擬公告（目前不需要調整）', { ms: 5000 });
      },
      onClose: () => render()
    });
  }

  // ---------- 事件繫結 ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('.tabs [data-view]');
    if (tab) { await flushVars(); state.view = tab.dataset.view; state.editingNote = null; render(); $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const d = b.dataset;
    switch (d.act) {
      case 'close-dlg': closeDialog(); break;
      case 'event-new': if (canManage() && await ensureUser()) openEventDialog(null); break;
      case 'event-edit': if (canManage()) openEventDialog(state.event); break;
      case 'user': // Store 沒有 setUser＝身分由公司登入系統決定，只顯示不給改
        if (Store.setUser) openUserDialog();
        else if (state.user) toast(`目前登入：${state.user.name}`);
        break;
      case 'logout': closeDialog(); await flushVars(); Store.logout(); break;
      case 'sync': if (Store.sync) { await Store.sync.now(); await loadEvents(); render(); } break;
      case 'user-add': openPersonDialog(null); break;
      case 'user-edit': openPersonDialog((U.list || []).find(x => x.email === d.id) || null); break;
      case 'user-toggle': {
        const u = (U.list || []).find(x => x.email === d.id);
        if (u) userCall(() => Store.admin.save({ email: u.email, name: u.name, pages: u.pages, enabled: !u.enabled }), u.enabled ? `已停用 ${u.email}` : `已啟用 ${u.email}`);
        break;
      }
      case 'user-delete': {
        const ok = await confirmDialog({ title: '刪除人員', message: `確定把 ${esc(d.id)} 移出名單？他的登入會立刻失效（勾選紀錄會保留）。`, okText: '刪除', danger: true });
        if (ok) userCall(() => Store.admin.remove(d.id), `已刪除 ${d.id}`);
        break;
      }
      case 'users-reload': U.list = null; U.error = ''; loadUsers(); break;
      case 'browse': state.browse = true; state.eventId = null; state.event = null; state.phase = 'all'; render(); break;
      case 'phase': state.phase = d.phase; render(); break;
      case 'dept': state.dept = d.dept; render(); break;
      case 'show': state.show = d.show; render(); break;
      case 'search-all': state.dept = 'all'; state.phase = 'all'; render(); break;
      case 'expand': state.expanded[d.id] = !state.expanded[d.id]; renderList(); { const m = $(`[data-act="expand"][data-id="${CSS.escape(d.id)}"]`); if (m) m.focus(); } break;
      case 'tpl': openTemplateDialog(d.tpl); break;
      case 'guide': openGuideDialog(d.guide); break;
      case 'note':
        if (!(await ensureUser())) return;
        state.editingNote = d.id; renderList();
        { const ta = $(`[data-note-for="${CSS.escape(d.id)}"]`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
        break;
      case 'note-cancel': state.editingNote = null; renderList(); break;
      case 'note-save': saveNote(d.id); break;
      case 'na': setStatus(d.id, statusOf(d.id) === 'na' ? 'todo' : 'na'); break;
      case 'goto': state.view = 'checklist'; state.dept = d.dept; state.phase = d.phase; state.show = 'all'; state.q = ''; render(); window.scrollTo(0, 0); break;
      case 'goto-item': await flushVars(); gotoItem(d.id); break;
      case 'set-phase': {
        if (!state.event || state.event.status === 'closed' || !canManage()) return;
        if (!(await ensureUser())) return;
        state.event = await Store.updateEvent(state.eventId, { currentPhase: d.phase });
        state.phase = 'current';
        await loadEvents(); render();
        toast(`目前階段：${PH[d.phase].name}`);
        break;
      }
      case 'event-close': {
        const ok = await confirmDialog({ title: '結束這個應變事件？', message: `結束後「${esc(state.event.name)}」的清單會變成唯讀，之後還可以重新開啟。建議先在「進度總覽」匯出 CSV 留存。`, okText: '結束事件' });
        if (!ok) return;
        await ensureUser();
        state.event = await Store.updateEvent(state.eventId, { status: 'closed' });
        await loadEvents(); render(); toast('事件已結束');
        break;
      }
      case 'event-reopen':
        await ensureUser();
        state.event = await Store.updateEvent(state.eventId, { status: 'active' });
        await loadEvents(); render(); toast('事件已重新開啟');
        break;
      case 'event-delete': {
        const ok = await confirmDialog({ title: '刪除應變事件', message: `確定刪除「${esc(state.event.name)}」？所有勾選、備註和操作紀錄會一起刪除，<b>無法復原</b>。`, okText: '刪除', danger: true });
        if (!ok) return;
        const name = state.event.name;
        await Store.deleteEvent(state.eventId);
        state.eventId = null; state.event = null; state.browse = false;
        await loadEvents(); render(); toast(`已刪除「${name}」`);
        break;
      }
      case 'export': exportCsv(); break;
      case 'goto-official':
        state.view = 'overview'; render();
        { const el = $('#official'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        break;
      case 'official-refresh': await syncOfficial(); render(); toast(state.official ? '官方公告已更新' : '讀不到官方公告（尚未接上來源）', { warn: !state.official }); break;
      case 'official-settings': openOfficialSettings(); break;
      case 'official-sim': openSimDialog(); break;
      case 'sim-clear':
        await Store.setSimulatedOfficial(null);
        closeDialog();
        await syncOfficial(); render(); toast('已清除模擬，回到真的公告');
        break;
      case 'copy': {
        await flushVars();
        const t = TPL[d.tpl];
        const r = fill(t, currentVars());
        const ok = await copyText(r.text);
        if (!ok) toast('無法自動複製，請手動選取內容複製', { warn: true });
        else if (t.kind === 'sms' && r.text.includes('暫停')) toast('已複製，但內容有「暫停」，三竹會發送失敗', { warn: true, ms: 4000 });
        else if (r.missing.length) toast(`已複製（還有 ${r.missing.length} 個欄位沒填，會顯示成【】）`, { warn: true, ms: 3600 });
        else toast('已複製，可以貼上了');
        break;
      }
      case 'orig': {
        state.openOriginals[d.tpl] = !state.openOriginals[d.tpl];
        const scope = b.closest('[data-tpl-card]');
        const p = scope && $(`[data-orig="${CSS.escape(d.tpl)}"]`, scope);
        if (p) p.hidden = !state.openOriginals[d.tpl];
        b.setAttribute('aria-expanded', String(!!state.openOriginals[d.tpl]));
        b.textContent = state.openOriginals[d.tpl] ? '收起原始範例' : '看原始範例';
        break;
      }
    }
  });

  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'eventSelect') {
      await flushVars();
      if (t.value === '__browse') { state.browse = true; state.eventId = null; state.event = null; state.phase = 'all'; }
      else { state.browse = false; state.eventId = t.value; state.phase = 'current'; state.event = await Store.getEvent(t.value); }
      state.editingNote = null;
      render();
      return;
    }
    if (t.dataset && t.dataset.act === 'toggle') {
      const id = t.dataset.id;
      const next = t.checked ? 'done' : 'todo';
      await setStatus(id, next);
    }
  });

  let qTimer = null;
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = t.value; renderList(); }, 120); return; }
    if (t.dataset && t.dataset.var) onVarInput(t);
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form="quick-create"]');
    if (!f) return;
    e.preventDefault();
    const name = String(new FormData(f).get('name') || '').trim();
    if (name) createEvent(name, '').catch(err => toast(err.message, { warn: true }));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.editingNote && !dlg.open) { state.editingNote = null; renderList(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.dataset && e.target.dataset.noteFor) saveNote(e.target.dataset.noteFor);
  });
  window.addEventListener('beforeunload', () => { flushVars(); });

  // 別的分頁（或雲端上的同事）改了資料
  let remotePending = false;
  async function refreshFromRemote() {
    remotePending = false;
    if (Store.getSettings) state.settings = await Store.getSettings();
    await loadEvents();
    render();
  }
  Store.subscribe(async () => {
    if (state.editingNote || dlg.open) { remotePending = true; return; } // 正在打字時不要打斷，關掉對話框後再更新
    await refreshFromRemote();
  });
  dlg.addEventListener('close', () => { if (remotePending) setTimeout(refreshFromRemote, 0); });

  // ---------- 開始 ----------
  (async function boot() {
    if (!DATA || !Store) { document.getElementById('main').textContent = '資料檔沒有載入（js/checklist-data.js、js/store.js）。'; return; }
    restoreUi();
    if (isCloud) {
      $('#main').innerHTML = '<section class="card empty"><p>正在讀取雲端資料…</p></section>';
      Store.sync.onStatus(renderSync);
      renderSync();
    }
    await Store.ready; // 雲端版：等登入、第一次下載完成
    state.user = await Store.getUser();
    if (Store.getSettings) state.settings = await Store.getSettings();
    await loadEvents();
    await syncOfficial();
    render();
    // 可以安裝到手機、離線開啟（service worker 只快取網站檔案，不快取資料）
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
    // 定時抓官方公告；切回這個分頁時也抓一次
    const tick = async () => { if (dlg.open || state.editingNote) return; await syncOfficial(); render(); };
    setInterval(tick, OFFICIAL_POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  })();
})();
