/*
 * 颱風應變檢核清單｜資料層（TyphoonStore）
 * ---------------------------------------------------------------
 * App 只透過這個介面讀寫「應變事件」與勾選紀錄。有兩種模式，介面相同：
 *   - 雲端版（config.js 填了 TC_AUTH.clientId 與 TC_CLOUD.url）：Google 登入，資料存在 Apps Script 後端，大家共用
 *     （同步引擎 js/cloud-sync.js、登入 js/auth.js，和倉儲 IT 整合中心同一套做法）
 *   - 單機版（沒填雲端網址）：資料只存在這台裝置的 localStorage
 * 合併進公司系統時，照下方介面改成呼叫公司後端 API 即可，app.js 不用改。每個方法都回傳 Promise。
 *
 * 介面
 *   mode                                'cloud' | 'local'
 *   ready                               Promise：資料可以讀了（雲端版要先登入、下載完）
 *   can(perm)                           畫面權限：'check' 勾選與備註、'manage' 建立事件／切換階段／連動設定；單機版全部 true
 *   getUser()                           → Promise<{ name, dept, email? } | null>   雲端版的名字來自 Google 登入，部門是這台裝置自己選的
 *   setUser({ name, dept })             → Promise<{ name, dept }>                   雲端版只存部門
 *   listEvents()                        → Promise<EventSummary[]>                   新到舊
 *   getEvent(id)                        → Promise<Event | null>
 *   createEvent({ name, note, typhoon, actor })                                    typhoon/actor 給系統依官方公告自動建立時用
 *   updateEvent(id, patch)              → Promise<Event>                   patch 可含 name, note, currentPhase, status, vars
 *   deleteEvent(id)                     → Promise<void>
 *   setItemStatus(eventId, itemId, { status, note })
 *                                       → Promise<Event>                   status: 'todo' | 'done' | 'na'；note 可省略（不變）
 *   subscribe(fn)                       → 取消函式                          別人（別的分頁／同事）改了資料時呼叫 fn()
 *   sync: { status(), onStatus(fn), now() } | null                         雲端同步狀態（單機版 null）
 *   logout()                            雲端版登出
 *   admin: { list(), save(user), remove(email) } | null                    人員與權限（雲端版的管理員才有）
 *
 *   ── 官方公告連動（規則在 official.js）──
 *   getSettings() / saveSettings(s)     關注縣市、總公司縣市、自動調整開關（雲端版全公司共用）
 *   getOfficialStatus()                 → Promise<OfficialStatus | null>   雲端版由 Apps Script 後端抓公告；單機版讀同層 official-status.json
 *   applyAuto(eventId, plan)            → Promise<Event>                   系統依公告自動調整：plan = { currentPhase?, vars?, autoKey?, reason, seenWarning? }
 *   setSimulatedOfficial(status|null)   → Promise<void>                    測試模式：用模擬公告取代真的公告（只影響這台裝置）
 *   serverRules                         true＝自動調整由後端做，畫面只顯示。目前是各裝置套用規則：系統自動建立的事件、
 *                                       自動動作的紀錄都用固定 id，好幾台同時套用也只會留下一份
 *
 * 資料格式（詳見 給工程師_整合說明.md）
 *   Event = {
 *     id, name, note, status: 'active' | 'closed', currentPhase: 'pre' | 'during' | 'after',
 *     templateVersion, createdAt, createdBy, updatedAt, closedAt, closedBy,
 *     vars:     { [欄位名稱]: 值 },                  範本 {{欄位}} 的填入值，整個事件共用
 *     progress: { [itemId]: { status, by, at, note, noteBy, noteAt } },   沒有紀錄＝未完成；by/at＝最後改狀態的人與時間
 *     log:      [{ id, at, by, type, itemId?, from?, to?, detail? }]   新的在後面；每筆有 id，雲端合併時兩邊新增的都保留
 *     typhoon:  null | { name, intlName, number }          系統依氣象署警報建立時才有
 *     auto:     { applied: { [階段]: 時間 }, seenWarning }  自動切換過哪些階段（每個階段只自動切一次）
 *     autoVars: { [欄位]: 值 }                            系統帶入的範本欄位值（人工改過就不再覆蓋）
 *   }
 *   Settings = { watchedCounties: ['臺南市', ...], hqCounty: '臺南市', autoAdjust: true, autoCreate: true }
 *   時間一律是 ISO 8601 字串（UTC）。by 是使用者顯示名稱。
 */
(function () {
  'use strict';

  var KEY = 'typhoon-checklist:v1';
  var USER_KEY = 'typhoon-checklist:user';
  var SETTINGS_KEY = 'typhoon-checklist:settings';
  var SIM_KEY = 'typhoon-checklist:official-sim';
  var OFFICIAL_URL = 'official-status.json'; // 單機版：tools/official-poller.mjs 寫出的檔案，和 index.html 放同一層
  var SYSTEM = '系統（官方公告）';
  var DEFAULT_SETTINGS = { watchedCounties: ['臺南市'], hqCounty: '臺南市', autoAdjust: true, autoCreate: true };
  var LOG_LIMIT = 1000;
  var PHASES = ['pre', 'during', 'after'];
  var STATUSES = ['todo', 'done', 'na'];

  var A = window.TCAuth, S = window.TCSync;
  var CLOUD = !!(A && A.enabled && S);

  function now() { return new Date().toISOString(); }
  function rnd() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lsGet(k, d) { try { var v = JSON.parse(window.localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  // ---------- 兩種儲存方式 ----------
  var memory = null; // localStorage 不能用時（例如隱私模式）退回記憶體，重新整理會消失
  function readAll() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var db = raw ? JSON.parse(raw) : null;
      return db && Array.isArray(db.events) ? db : { events: [] };
    } catch (e) { return memory || { events: [] }; }
  }
  function writeAll(db) { try { window.localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { memory = db; } }

  var B = CLOUD ? {
    events: function () { return S.list('events'); },
    save: function (ev) { S.save('events', ev); },
    remove: function (id) { S.remove('events', id); },
    settings: function () { var s = S.get('settings', 'settings'); return s ? clone(s) : null; },
    saveSettings: function (s) { S.save('settings', Object.assign({ id: 'settings' }, s)); }
  } : {
    events: function () { return readAll().events; },
    save: function (ev) {
      var db = readAll(), i = db.events.findIndex(function (e) { return e.id === ev.id; });
      if (i >= 0) db.events[i] = ev; else db.events.push(ev);
      writeAll(db);
    },
    remove: function (id) { var db = readAll(); db.events = db.events.filter(function (e) { return e.id !== id; }); writeAll(db); },
    settings: function () { return lsGet(SETTINGS_KEY, null); },
    saveSettings: function (s) { lsSet(SETTINGS_KEY, s); }
  };

  function findEvent(id) { return B.events().find(function (e) { return e.id === id; }) || null; }
  function currentUserName() {
    if (CLOUD) return A.name() || '未具名';
    var u = lsGet(USER_KEY, null);
    return (u && u.name) || '未具名';
  }
  function summary(ev) {
    return {
      id: ev.id, name: ev.name, status: ev.status, currentPhase: ev.currentPhase, typhoon: ev.typhoon || null,
      createdAt: ev.createdAt, updatedAt: ev.updatedAt, closedAt: ev.closedAt || null
    };
  }
  function pushLog(ev, entry) {
    ev.log = ev.log || [];
    entry.id = entry.id || 'lg_' + rnd();
    if (ev.log.some(function (l) { return l.id === entry.id; })) return; // 固定 id 的系統紀錄只留一份
    entry.at = entry.at || now();
    entry.by = entry.by || currentUserName();
    ev.log.push(entry);
    if (ev.log.length > LOG_LIMIT) ev.log.splice(0, ev.log.length - LOG_LIMIT);
  }
  function mutate(id, fn) {
    var cur = findEvent(id);
    if (!cur) return Promise.reject(new Error('找不到這個應變事件'));
    var ev = clone(cur);
    try { fn(ev); } catch (e) { return Promise.reject(e); }
    ev.updatedAt = now();
    B.save(ev);
    return Promise.resolve(clone(ev));
  }
  // 系統依颱風警報建立的事件用固定 id：好幾台裝置同時建立也會合併成同一個
  function typhoonEventId(t) {
    var key = String(t.number || t.intlName || t.name || '').replace(/[^A-Za-z0-9一-鿿]/g, '');
    return 'ev_ty_' + new Date().getFullYear() + '_' + key;
  }

  var Store = {
    mode: CLOUD ? 'cloud' : 'local',
    ready: CLOUD ? Promise.all([A.ready, S.ready]).then(function () {}) : Promise.resolve(),
    can: function (perm) { return CLOUD ? A.can(perm) : true; },

    getUser: function () {
      var u = lsGet(USER_KEY, null);
      if (CLOUD) return Promise.resolve(A.user() ? { name: A.name(), email: A.email(), dept: (u && u.dept) || '' } : null);
      return Promise.resolve(u);
    },
    setUser: function (u) {
      var clean = { name: CLOUD ? A.name() : String(u.name || '').trim(), dept: String(u.dept || '') };
      lsSet(USER_KEY, CLOUD ? { dept: clean.dept } : clean); // 雲端版只記這台裝置選的部門
      return Promise.resolve(clean);
    },

    listEvents: function () {
      var list = B.events().map(summary);
      list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      return Promise.resolve(list);
    },
    getEvent: function (id) {
      var ev = findEvent(id);
      return Promise.resolve(ev ? clone(ev) : null);
    },
    createEvent: function (input) {
      input = input || {};
      var name = String(input.name || '').trim();
      if (!name) return Promise.reject(new Error('請輸入颱風名稱'));
      var id = input.typhoon ? typhoonEventId(input.typhoon) : 'ev_' + rnd();
      var existing = findEvent(id);
      if (existing) return Promise.resolve(Object.assign(clone(existing), { existed: true }));
      var tpl = window.TYPHOON_CHECKLIST || {};
      var t = now();
      var actor = input.actor || currentUserName();
      var ev = {
        id: id, name: name, note: String(input.note || '').trim(),
        status: 'active', currentPhase: 'pre', templateVersion: tpl.version || '',
        createdAt: t, createdBy: actor, updatedAt: t, closedAt: null, closedBy: null,
        typhoon: input.typhoon || null, auto: { applied: {}, seenWarning: !!input.typhoon }, autoVars: {},
        vars: {}, progress: {}, log: []
      };
      pushLog(ev, { id: input.typhoon ? 'lg_create_' + id : undefined, type: 'event.create', detail: name, by: actor });
      B.save(ev);
      return Promise.resolve(clone(ev));
    },
    updateEvent: function (id, patch) {
      return mutate(id, function (ev) {
        if ('name' in patch) {
          var n = String(patch.name || '').trim();
          if (n && n !== ev.name) { pushLog(ev, { type: 'event.rename', from: ev.name, to: n }); ev.name = n; }
        }
        if ('note' in patch) ev.note = String(patch.note || '');
        if ('currentPhase' in patch && PHASES.indexOf(patch.currentPhase) >= 0 && patch.currentPhase !== ev.currentPhase) {
          pushLog(ev, { type: 'event.phase', from: ev.currentPhase, to: patch.currentPhase });
          ev.currentPhase = patch.currentPhase;
        }
        if ('status' in patch && (patch.status === 'active' || patch.status === 'closed') && patch.status !== ev.status) {
          ev.status = patch.status;
          ev.closedAt = patch.status === 'closed' ? now() : null;
          ev.closedBy = patch.status === 'closed' ? currentUserName() : null;
          pushLog(ev, { type: patch.status === 'closed' ? 'event.close' : 'event.reopen' });
        }
        if (patch.vars && typeof patch.vars === 'object') {
          ev.vars = ev.vars || {};
          Object.keys(patch.vars).forEach(function (k) {
            var v = String(patch.vars[k] == null ? '' : patch.vars[k]);
            if (v) ev.vars[k] = v; else delete ev.vars[k];
          });
        }
      });
    },
    deleteEvent: function (id) {
      B.remove(id);
      return Promise.resolve();
    },
    setItemStatus: function (eventId, itemId, change) {
      return mutate(eventId, function (ev) {
        if (ev.status === 'closed') throw new Error('這個事件已結束，要先重新開啟才能修改');
        ev.progress = ev.progress || {};
        var prev = ev.progress[itemId] || { status: 'todo', note: '' };
        var next = { status: prev.status, note: prev.note || '', by: prev.by, at: prev.at, noteBy: prev.noteBy, noteAt: prev.noteAt };
        if (change.status && STATUSES.indexOf(change.status) >= 0 && change.status !== prev.status) {
          next.status = change.status;
          next.by = currentUserName();
          next.at = now();
          pushLog(ev, { type: 'item.status', itemId: itemId, from: prev.status, to: change.status });
        }
        if (typeof change.note === 'string' && change.note.trim() !== (prev.note || '')) {
          next.note = change.note.trim();
          next.noteBy = currentUserName();
          next.noteAt = now();
          pushLog(ev, { type: 'item.note', itemId: itemId, detail: next.note });
        }
        if (next.status === 'todo' && !next.note) delete ev.progress[itemId];
        else ev.progress[itemId] = JSON.parse(JSON.stringify(next)); // 去掉 undefined 欄位
      });
    },

    subscribe: function (fn) {
      if (CLOUD) {
        var on = true;
        S.on(function (type, payload) { if (on && type === 'change' && !(payload && payload.local)) fn(); });
        return function () { on = false; };
      }
      var h = function (e) { if (e.key === KEY) fn(); };
      window.addEventListener('storage', h);
      return function () { window.removeEventListener('storage', h); };
    },
    sync: CLOUD ? {
      status: function () { return S.status(); },
      onStatus: function (fn) { S.on(function (type, st) { if (type === 'status') fn(st); }); },
      now: function () { return S.syncNow(); }
    } : null,
    logout: function () { return CLOUD ? A.logout() : Promise.resolve(false); },
    admin: CLOUD ? {
      enabled: function () { return A.isAdmin(); },
      list: function () { return A.api('users'); },
      save: function (u) { return A.api('userSave', u); },
      remove: function (email) { return A.api('userDelete', { email: email }); }
    } : null,

    // ---------- 官方公告連動 ----------
    serverRules: false,
    getSettings: function () {
      return Promise.resolve(Object.assign({}, DEFAULT_SETTINGS, B.settings() || {}, { id: undefined }));
    },
    saveSettings: function (s) {
      var clean = {
        watchedCounties: Array.isArray(s.watchedCounties) ? s.watchedCounties.slice() : DEFAULT_SETTINGS.watchedCounties.slice(),
        hqCounty: String(s.hqCounty || DEFAULT_SETTINGS.hqCounty),
        autoAdjust: s.autoAdjust !== false, autoCreate: s.autoCreate !== false
      };
      B.saveSettings(clean);
      return Promise.resolve(clean);
    },
    getOfficialStatus: function () {
      var sim = lsGet(SIM_KEY, null);
      if (sim) return Promise.resolve(sim);
      if (CLOUD) return A.api('official').then(function (j) { return j.official || null; }).catch(function () { return null; });
      if (location.protocol === 'file:' || !window.fetch) return Promise.resolve(null); // 直接開檔案時讀不到同層 JSON
      return fetch(OFFICIAL_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    },
    setSimulatedOfficial: function (status) {
      try {
        if (status) window.localStorage.setItem(SIM_KEY, JSON.stringify(Object.assign({}, status, { source: 'simulated' })));
        else window.localStorage.removeItem(SIM_KEY);
      } catch (e) { /* 存不了就算了 */ }
      return Promise.resolve();
    },
    applyAuto: function (eventId, plan) {
      return mutate(eventId, function (ev) {
        if (ev.status === 'closed') return;
        ev.auto = ev.auto || { applied: {} };
        ev.auto.applied = ev.auto.applied || {};
        ev.autoVars = ev.autoVars || {};
        ev.vars = ev.vars || {};
        if (plan.seenWarning) ev.auto.seenWarning = true;
        if (plan.currentPhase && PHASES.indexOf(plan.currentPhase) >= 0 && plan.currentPhase !== ev.currentPhase) {
          pushLog(ev, { id: 'lg_auto_' + plan.currentPhase, type: 'event.phase', from: ev.currentPhase, to: plan.currentPhase, detail: plan.reason, by: SYSTEM });
          ev.currentPhase = plan.currentPhase;
          if (plan.autoKey) ev.auto.applied[plan.autoKey] = now();
        }
        if (plan.vars) {
          var filled = [];
          Object.keys(plan.vars).forEach(function (k) {
            var v = String(plan.vars[k] || '');
            if (!v) return;
            ev.vars[k] = v; ev.autoVars[k] = v; filled.push(k + '＝' + v);
          });
          if (filled.length) pushLog(ev, { id: 'lg_vars_' + filled.join('|').replace(/[^A-Za-z0-9一-鿿]/g, '').slice(0, 60), type: 'event.vars', detail: filled.join('、'), by: SYSTEM });
        }
      });
    }
  };

  window.TyphoonStore = Store;
})();
