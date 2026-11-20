/*
 * 颱風應變檢核清單｜官方公告連動（TyphoonOfficial）
 * ---------------------------------------------------------------
 * 純函式，瀏覽器和 Node.js 都能用（後端排程可以直接 require 這支，規則只寫一份）。
 *
 *   parseTyphoonCap(xml)      中央氣象署颱風警報 CAP（經 NCDR 民生示警平台或氣象署開放資料取得）→ TyphoonWarning
 *   parseDgpaHtml(html)       人事行政總處「天然災害停止上班及上課情形」網頁 → Closures
 *   classifyClosure(text)     一個縣市的公告文字 → { today, tomorrow }，值為 closed / partial / normal / null
 *   evaluate(official, settings, event)
 *                             依官方公告算出：應該在哪個階段、要自動帶入的範本欄位、生產部情境 A／B、要不要自動建立事件
 *
 * 官方資料統一整理成 OfficialStatus：
 *   {
 *     fetchedAt: ISO,
 *     typhoon: null | {
 *       name: '沙德爾', intlName: 'SAUDEL', number: '18',
 *       warningType: 'sea' | 'land' | 'sea_land' | 'lifted',   海上／陸上／海上陸上警報／解除
 *       headline: '海上颱風警報', reportNo: '1',
 *       status: 'Actual' | 'Test' | ...,  msgType: 'Alert' | 'Update' | 'Cancel',
 *       sent, effective, expires, web, identifier
 *     },
 *     closures: null | {
 *       date: 'YYYY-MM-DD'（公告頁面的日期，「今天」「明天」以此為準）, updatedAt: ISO,
 *       counties: [{ county: '臺南市', text: '明天停止上班、停止上課。', today: 'normal', tomorrow: 'closed' }]
 *     },
 *     source: 'live' | 'simulated'
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TyphoonOfficial = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣',
    '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
  var PHASE_ORDER = { pre: 0, during: 1, after: 2 };
  var SYSTEM_ACTOR = '系統（官方公告）';
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function normCounty(s) { return String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').trim(); }
  function decodeEntities(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
  }
  function stripTags(html) { return decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim(); }

  // ---------- 中央氣象署颱風警報（CAP 1.2） ----------
  function tag(xml, name) {
    var m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(xml);
    return m ? decodeEntities(m[1].trim()) : '';
  }
  function section(xml, title) {
    var m = new RegExp('<section\\s+title="' + title + '"\\s*>([\\s\\S]*?)</section>').exec(xml);
    return m ? stripTags(m[1]) : '';
  }
  function param(xml, name) {
    var m = new RegExp('<parameter>\\s*<valueName>' + name + '</valueName>\\s*<value>([\\s\\S]*?)</value>\\s*</parameter>').exec(xml);
    return m ? decodeEntities(m[1].trim()) : '';
  }
  function warningTypeOf(headline, kind, msgType) {
    var h = String(headline || ''), k = String(kind || '').toUpperCase();
    if (msgType === 'Cancel' || /解除/.test(h)) return 'lifted';
    if (/海上陸上/.test(h) || (k.indexOf('SEA') >= 0 && k.indexOf('LAND') >= 0)) return 'sea_land';
    if (/陸上/.test(h) || k === 'LAND') return 'land';
    if (/海上/.test(h) || k === 'SEA') return 'sea';
    return '';
  }
  function parseTyphoonCap(xml) {
    xml = String(xml || '');
    if (!/<alert[\s>]/.test(xml)) return null;
    var info = tag(xml, 'info') ? xml.slice(xml.indexOf('<info')) : xml;
    var headline = tag(info, 'headline');
    var msgType = tag(xml, 'msgType');
    var w = {
      identifier: tag(xml, 'identifier'),
      status: tag(xml, 'status'),
      msgType: msgType,
      sent: tag(xml, 'sent'),
      event: tag(info, 'event'),
      headline: headline || param(info, 'severity_level'),
      effective: tag(info, 'effective'),
      expires: tag(info, 'expires'),
      web: tag(info, 'web'),
      reportNo: section(info, '警報報數'),
      number: section(info, '颱風編號'),
      name: tag(info, 'cwa_typhoon_name'),
      intlName: tag(info, 'typhoon_name'),
      warningType: warningTypeOf(headline || param(info, 'severity_level'), section(info, '警報類別'), msgType)
    };
    if (!w.name) { var m = /(?:颱風|熱帶性低氣壓)\s*([一-鿿]{2,4})（國際命名/.exec(section(info, '命名與位置')); if (m) w.name = m[1]; }
    if (w.event && w.event !== '颱風') return null; // 不是颱風警報
    return w;
  }

  // ---------- 人事行政總處 停止上班上課 ----------
  function classifyClosure(text) {
    var out = { today: null, tomorrow: null };
    var day = 'today';
    String(text || '').replace(/\n/g, '。').split('。').forEach(function (raw) {
      var s = raw.trim();
      if (!s) return;
      if (/明天|明日/.test(s)) day = 'tomorrow';
      else if (/今天|今日|今晚|今夜/.test(s)) day = 'today';
      var v = null;
      if (/停止上班/.test(s)) {
        // 只有部分行政區停班（例：「安南區、七股區停止上班」）或「其餘照常」→ partial
        var lead = s.split('停止上班')[0];
        v = (/[區鄉鎮里]/.test(lead.replace(/今天|明天|今日|明日/g, '')) || /部分|部份/.test(s)) ? 'partial' : 'closed';
      } else if (/照常上班|尚未列入警戒區|正常上班/.test(s)) {
        v = 'normal';
      }
      if (!v) return;
      var cur = out[day];
      // 同一天有停班也有照常（例：「上午照常上班，下午停止上班」）→ 以停班為準
      if (!cur || v === 'closed' || (v === 'partial' && cur === 'normal')) out[day] = v;
    });
    return out;
  }
  function rocDate(html) {
    var m = /(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(stripTags(html));
    if (!m) return '';
    return (1911 + +m[1]) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  function parseDgpaHtml(html) {
    html = String(html || '');
    var upd = /更新時間[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(html);
    var p2 = function (x) { return ('0' + x).slice(-2); };
    // 頁面時間是台灣時間；明確加 +08:00，排程跑在 UTC 主機上也不會差 8 小時
    var updatedAt = upd ? new Date(upd[1] + '-' + p2(upd[2]) + '-' + p2(upd[3]) + 'T' + p2(upd[4]) + ':' + upd[5] + ':' + p2(upd[6] || 0) + '+08:00').toISOString() : '';
    var date = rocDate(html) || (upd ? upd[1] + '-' + ('0' + upd[2]).slice(-2) + '-' + ('0' + upd[3]).slice(-2) : '');
    var counties = [], unparsed = [];
    var rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    rows.forEach(function (row) {
      var cells = row.match(/<td[\s\S]*?<\/td>/gi);
      if (!cells || cells.length < 2) return;
      var name = normCounty(stripTags(cells[0]));
      if (COUNTIES.indexOf(name) < 0) { if (name && name.length < 12) unparsed.push(name); return; }
      var text = cells.slice(1).map(stripTags).join('\n').trim();
      var c = classifyClosure(text);
      counties.push({ county: name, text: text, today: c.today, tomorrow: c.tomorrow });
    });
    return { date: date, updatedAt: updatedAt, counties: counties, empty: /無停班停課訊息/.test(html), unparsed: unparsed };
  }

  // ---------- 規則 ----------
  function addDays(ymd, n) {
    var p = String(ymd).split('-');
    var d = new Date(+p[0], p[1] - 1, +p[2] + n);
    return d;
  }
  function fmtDay(d) { return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEK[d.getDay()] + ')'; }
  function typhoonLabel(name) { var n = String(name || '').trim(); return !n || /颱風$/.test(n) ? n : n + '颱風'; }
  function isOff(v) { return v === 'closed' || v === 'partial'; }

  /**
   * @param official  OfficialStatus
   * @param settings  { watchedCounties: ['臺南市', ...], hqCounty: '臺南市', autoAdjust, autoCreate }
   * @param event     目前的應變事件（可為 null）
   * @returns {
   *   warningActive, typhoon, closures: [{ county, day, kind, date, text }], hqClosed, scenario: 'A'|'B'|null,
   *   phase: 'pre'|'during'|'after'|null, reason, vars: {}, createEvent: null|{ name, typhoon }, summary: [文字]
   * }
   */
  function evaluate(official, settings, event) {
    official = official || {};
    settings = settings || {};
    var watched = (settings.watchedCounties || []).map(normCounty);
    var hq = normCounty(settings.hqCounty || '臺南市');
    var t = official.typhoon && official.typhoon.status === 'Actual' ? official.typhoon : null; // 測試訊息（status=Test）一律忽略
    if (t && t.expires && Date.parse(t.expires) < Date.now() && t.warningType !== 'lifted' && official.source !== 'simulated') t = null; // 過期的警報
    var warningActive = !!(t && /^(sea|land|sea_land)$/.test(t.warningType));
    var cl = official.closures || { counties: [] };
    var closures = [];
    (cl.counties || []).forEach(function (c) {
      if (watched.indexOf(c.county) < 0 && c.county !== hq) return;
      ['today', 'tomorrow'].forEach(function (day) {
        if (!isOff(c[day])) return;
        var d = cl.date ? addDays(cl.date, day === 'tomorrow' ? 1 : 0) : null;
        closures.push({ county: c.county, day: day, kind: c[day], date: d ? fmtDay(d) : (day === 'today' ? '今天' : '明天'), text: c.text });
      });
    });
    var hqClosed = closures.some(function (c) { return c.county === hq && c.kind === 'closed'; });
    var r = {
      warningActive: warningActive, typhoon: t, closures: closures, hqClosed: hqClosed,
      scenario: closures.length ? (hqClosed ? 'A' : 'B') : null,
      phase: null, reason: '', vars: {}, createEvent: null, summary: []
    };

    if (t) r.summary.push('中央氣象署：' + typhoonLabel(t.name) + ' ' + (t.warningType === 'lifted' ? '解除颱風警報' : t.headline) + (t.reportNo ? '（第' + t.reportNo + '報）' : ''));
    if (closures.length) {
      r.summary.push('人事行政總處：' + closures.map(function (c) { return c.county + c.date + (c.kind === 'partial' ? '部分地區' : '') + '停止上班'; }).join('、'));
    } else if (cl.counties && (cl.updatedAt || cl.date)) {
      r.summary.push('人事行政總處：關注的縣市目前沒有停班');
    }

    var cur = event ? event.currentPhase : null;
    if (closures.length) {
      r.phase = 'during';
      r.reason = '人事行政總處公告 ' + uniq(closures.map(function (c) { return c.county; })).join('、') + ' 停止上班';
    } else if (warningActive) {
      r.phase = 'pre';
      r.reason = '中央氣象署發布' + typhoonLabel(t.name) + t.headline;
    } else if (event && (cur === 'during' || (cur === 'pre' && event.auto && event.auto.seenWarning))) {
      r.phase = 'after';
      r.reason = t && t.warningType === 'lifted' ? '中央氣象署已解除颱風警報，關注的縣市已恢復上班' : '颱風警報已結束，關注的縣市已恢復上班';
    }

    if (t && t.name) r.vars['颱風名稱'] = typhoonLabel(t.name);
    if (closures.length) {
      r.vars['停班日期'] = uniq(closures.map(function (c) { return c.date; })).join('、');
      r.vars['停班地區'] = uniq(closures.map(function (c) { return c.county.replace(/[市縣]$/, ''); })).join('、');
      var hqDays = uniq(closures.filter(function (c) { return c.county === hq; }).map(function (c) { return c.date; }));
      if (hqDays.length) r.vars['台南停班日'] = hqDays.join('、'); // 欄位名稱沿用範本；總公司不在台南時一樣代表總公司所在縣市
    }
    if (warningActive && settings.autoCreate !== false) {
      r.createEvent = { name: typhoonLabel(t.name), typhoon: { name: t.name, intlName: t.intlName, number: t.number } };
    }
    return r;
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function isForward(from, to) { return to in PHASE_ORDER && (!(from in PHASE_ORDER) || PHASE_ORDER[to] > PHASE_ORDER[from]); }

  /**
   * 算出要對事件做的自動調整（只會往後推進階段；同一個階段自動切換過一次就不再自動切，主管手動改回來也不會被蓋掉）。
   * 範本欄位只填「空的」或「上次也是系統填的」，人工改過的不動。
   * @returns null 或 { currentPhase?, vars?, autoKey?, reason, seenWarning? }
   */
  function planAutoUpdate(event, result, settings) {
    if (!event || event.status === 'closed') return null;
    var auto = event.auto || {};
    var applied = auto.applied || {};
    var autoVars = event.autoVars || {};
    var plan = { reason: result.reason || '依官方公告更新' };
    var changed = false;
    if (settings.autoAdjust !== false && result.phase && isForward(event.currentPhase, result.phase) && !applied[result.phase]) {
      plan.currentPhase = result.phase;
      plan.autoKey = result.phase;
      changed = true;
    }
    var vars = {};
    Object.keys(result.vars).forEach(function (k) {
      var cur = (event.vars || {})[k] || '';
      var want = result.vars[k];
      if (cur === want) return;
      if (!cur || cur === autoVars[k]) { vars[k] = want; changed = true; }
    });
    if (Object.keys(vars).length) plan.vars = vars;
    if (result.warningActive && !auto.seenWarning) { plan.seenWarning = true; changed = true; }
    return changed ? plan : null;
  }
  // 公告的颱風對應到哪個事件：同颱風編號／名稱的事件優先，否則最新的進行中事件
  function matchEvent(events, typhoon) {
    var active = (events || []).filter(function (e) { return e.status === 'active'; });
    if (typhoon) {
      var same = active.find(function (e) {
        return (e.typhoon && ((typhoon.number && e.typhoon.number === typhoon.number) || e.typhoon.name === typhoon.name)) ||
          (typhoon.name && String(e.name).indexOf(typhoon.name) >= 0);
      });
      if (same) return same;
    }
    return active[0] || null;
  }

  return {
    COUNTIES: COUNTIES, SYSTEM_ACTOR: SYSTEM_ACTOR,
    normCounty: normCounty, parseTyphoonCap: parseTyphoonCap, parseDgpaHtml: parseDgpaHtml, classifyClosure: classifyClosure,
    evaluate: evaluate, planAutoUpdate: planAutoUpdate, matchEvent: matchEvent, fmtDay: fmtDay, typhoonLabel: typhoonLabel, isForward: isForward
  };
});
