/* PATTA Event Mode · ตัวเผยแพร่ตัวเลขสรุป + แถบนับถอยหลัง
 *
 * วิธีติดตั้ง: เพิ่มบรรทัดเดียวใน event.html ก่อน </body>
 *     <script src="stats-publisher.js"></script>
 *
 * ทำ 2 อย่าง
 *  1) เมื่อสตาฟที่ล็อกอินอยู่เปิดหน้า Event Mode ไว้ จะรวมตัวเลขสรุป "เท่านั้น"
 *     (ไม่มีชื่อ เบอร์โทร หรือโน้ตของแขก) แล้วเขียนที่ event_stats/summary
 *     ให้หน้า dashboard.html เปิดดูได้โดยไม่ต้องล็อกอิน
 *     (โหมดซ้อม ?test=1 จะเขียนที่ event_stats/summary_test แทน)
 *  2) แสดงแถบนับถอยหลังสู่วันงานบนแท็บ "แดชบอร์ด"
 */
(function () {
  'use strict';
  if (window.__pattaStats) return;
  window.__pattaStats = true;

  var EVENT_START = '2026-11-20T00:00:00+07:00'; // นับถึงเที่ยงคืนต้นวันงาน 20 พ.ย. 69 (แก้ได้)
  var EVENT_END = '2026-11-21T20:00:00+07:00';
  var DAYS = ['20', '21'];
  var PUBLISH_DELAY_MS = 20000;

  var qs = new URLSearchParams(location.search);
  var TEST = qs.get('test') === '1';
  var DRY = !!window.PATTA_STATS_DRY; // true = คำนวณอย่างเดียว ไม่เขียนขึ้น Firestore
  var GUESTS = TEST ? 'event_guests_test' : 'event_guests';
  var STATS_DOC = TEST ? 'summary_test' : 'summary';

  /* ---------- ตัวช่วย ---------- */
  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? v : 0; }
  function add(o, k, n) { o[k] = (o[k] || 0) + n; }

  // ช่องทางรู้จักงานเป็นข้อความอิสระ จึงจัดเป็นกลุ่มมาตรฐานก่อนเผยแพร่ (กันชื่อบุคคลหลุดออกไป)
  function mediaBucket(m) {
    m = String(m || '').toLowerCase();
    if (!m) return 'ไม่ระบุ';
    if (/invitation|การ์ด/.test(m)) return 'การ์ดเชิญออนไลน์';
    if (/facebook|(^|\W)fb(\W|$)/.test(m)) return 'Facebook';
    if (/google/.test(m)) return 'Google';
    if (/(^|\W)line(\W|$)/.test(m)) return 'LINE';
    if (/referral|แนะนำ/.test(m)) return 'คนรู้จักแนะนำ';
    if (/ป้าย|billboard/.test(m)) return 'ป้ายโฆษณา';
    if (/ขับรถ/.test(m)) return 'ขับรถผ่าน';
    if (/agency|agent|เอเจนท์/.test(m)) return 'Agency';
    if (/ฝ่ายขาย|เซลล์|sale/.test(m)) return 'ฝ่ายขาย/เซลล์';
    return 'อื่นๆ';
  }

  function emptyScope() {
    return {
      reg: { customer: { pax: 0, n: 0 }, agent: { pax: 0, n: 0 } },
      inn: {
        customer: { pre: { pax: 0, n: 0 }, walk: { pax: 0, n: 0 } },
        agent: { pre: { pax: 0, n: 0 }, walk: { pax: 0, n: 0 } }
      },
      slots: {},
      media: {}
    };
  }

  /* ---------- รวมตัวเลข (ไม่มีข้อมูลระบุตัวบุคคล) ---------- */
  function aggregate(list) {
    var S = { '20': emptyScope(), '21': emptyScope(), all: emptyScope() };
    var houses = {};
    var records = 0;

    list.forEach(function (g) {
      records++;
      var t = g.type === 'agent' ? 'agent' : 'customer';
      var walk = g.src === 'walk';
      var pax = num(g.pax);
      var ci = g.checkins || {};

      if (!walk) {
        S.all.reg[t].pax += pax; S.all.reg[t].n++;
        DAYS.forEach(function (d) {
          if (g.prefDate === d || g.prefDate === 'both') { S[d].reg[t].pax += pax; S[d].reg[t].n++; }
          var slot = g.slots && g.slots[d];
          if (typeof slot === 'string' && slot) {
            var row = S[d].slots[slot] || (S[d].slots[slot] = { customer: 0, agent: 0, inn: 0 });
            row[t] += pax;
            if (ci[d]) row.inn += num(ci[d].pax) || 1;
          }
        });
      }

      var maxPax = 0;
      var src = walk ? 'walk' : 'pre';
      DAYS.forEach(function (d) {
        if (!ci[d]) return;
        var p = num(ci[d].pax) || 1;
        S[d].inn[t][src].pax += p; S[d].inn[t][src].n++;
        add(S[d].media, mediaBucket(g.media), p);
        if (p > maxPax) maxPax = p;
      });
      if (maxPax) { // รวม 2 วัน นับคนไม่ซ้ำ: ใช้จำนวนคนมากสุดของวันที่มา
        S.all.inn[t][src].pax += maxPax; S.all.inn[t][src].n++;
        add(S.all.media, mediaBucket(g.media), maxPax);
      }

      var seen = {};
      (g.notes || []).forEach(function (n) {
        (n && n.houses || []).forEach(function (h) {
          if (typeof h === 'string' && h.length < 80) seen[h] = 1;
        });
      });
      Object.keys(seen).forEach(function (h) { add(houses, h, 1); });
    });

    return { v: 1, records: records, scopes: S, houses: houses };
  }
  window.__pattaAggregate = aggregate;

  /* ---------- เผยแพร่ขึ้น Firestore ---------- */
  var unsub = null, timer = null, lastSig = '', warned = false;

  function publish(db, snap) {
    if (!snap.size) return; // ไม่เผยแพร่ถ้าไม่มีข้อมูล กันเขียนทับตัวเลขเดิมด้วยค่าว่าง
    var agg = aggregate(snap.docs.map(function (d) { return d.data(); }));
    var sig = JSON.stringify(agg);
    window.__pattaStatsLast = agg;
    if (DRY || sig === lastSig) return;
    db.collection('event_stats').doc(STATS_DOC).set({
      json: sig,
      updatedAt: new Date().toISOString()
    }).then(function () { lastSig = sig; }).catch(function (e) {
      if (!warned) { warned = true; console.warn('[stats] เผยแพร่ตัวเลขสรุปไม่สำเร็จ (ตรวจกฎ Firestore):', e && e.message); }
    });
  }

  function start() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    var db = firebase.firestore();
    firebase.auth().onAuthStateChanged(function (u) {
      if (unsub) { unsub(); unsub = null; }
      if (!u) return;
      unsub = db.collection(GUESTS).onSnapshot(function (snap) {
        clearTimeout(timer);
        timer = setTimeout(function () { publish(db, snap); }, DRY ? 500 : PUBLISH_DELAY_MS);
      }, function () { /* ไม่มีสิทธิ์/ออฟไลน์: ข้าม */ });
    });
  }

  /* ---------- แถบนับถอยหลังบนแท็บแดชบอร์ด ----------
     ใช้เวลาจริงจากเซิร์ฟเวอร์ (หัว HTTP Date) ไม่เชื่อนาฬิกาเครื่อง */
  var skew = 0;
  function nowMs() { return Date.now() + skew; }
  function syncClock() {
    var t0 = Date.now();
    fetch(location.pathname + '?_t=' + t0, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var h = r.headers.get('Date'); if (!h) return;
      var srv = Date.parse(h), t1 = Date.now();
      if (!isNaN(srv)) skew = srv + (t1 - t0) / 2 - t1;
    }).catch(function () {});
  }
  function bannerText() {
    var now = nowMs(), s = Date.parse(EVENT_START), e = Date.parse(EVENT_END);
    if (now >= e) return 'จบงานแล้ว · ขอบคุณทุกท่าน';
    if (now >= s) return 'งาน Grand Opening เริ่มแล้ว!';
    var sec = Math.floor((s - now) / 1000);
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return 'อีก ' + d + ' วัน ' + h + ' ชม. ' + m + ' นาที ' + x + ' วินาที';
  }

  var BANNER_ID = 'pattaCountdown';
  function ensureBanner() {
    var root = document.getElementById('root');
    var tabs = document.getElementById('tabs');
    var on = tabs && tabs.querySelector('button.on');
    var onDash = on && on.textContent.trim() === 'แดชบอร์ด';
    var el = document.getElementById(BANNER_ID);
    if (!onDash) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.style.cssText = 'margin:10px 0;padding:12px 14px;border-radius:12px;background:#1b2f55;color:#fff;text-align:center;font-weight:600;line-height:1.5';
      el.innerHTML = '<div style="font-size:12px;font-weight:400;opacity:.8">นับถอยหลังสู่ PATTA Grand Opening · 20 พ.ย. 69</div><div data-t style="font-size:18px"></div>';
      tabs.insertAdjacentElement('afterend', el);
    }
    el.querySelector('[data-t]').textContent = bannerText();
  }

  function watchBanner() {
    var root = document.getElementById('root');
    if (!root) return;
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; ensureBanner(); });
    }).observe(root, { childList: true, subtree: true });
    setInterval(ensureBanner, 1000);
    ensureBanner();
  }

  function boot() { syncClock(); setInterval(syncClock, 600000); start(); watchBanner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
