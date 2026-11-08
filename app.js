/* もがみ 現場ノート — 画面の動き */
(function () {
'use strict';

var CFG = window.GN_CONFIG || {};
var WD = ['日', '月', '火', '水', '木', '金', '土'];
var STAMPS = [
  { k: 'thanks', em: '🙏', label: 'ありがとう', bg: '#ffd9a8' },
  { k: 'saved', em: '🙌', label: '助かった！', bg: '#c9ecc0' },
  { k: 'great', em: '🔥', label: 'さすが', bg: '#ffc4b5' },
  { k: 'shiny', em: '✨', label: 'ピカピカ', bg: '#fff0a8' },
  { k: 'nice', em: '👍', label: 'ナイス', bg: '#bfe0ff' },
  { k: 'please', em: '🤲', label: 'おねがい', bg: '#e6d4ff' },
  { k: 'otsu', em: '😊', label: 'おつかれ', bg: '#ffd1e6' },
  { k: 'best', em: '🎉', label: '最高', bg: '#d6f2ec' }
];
var STAMP = {}; STAMPS.forEach(function (s) { STAMP[s.k] = s; });

var S = null;             // サーバーから来た最新の状態
var code = ls('gn_code'), me = ls('gn_me');
var tab = new URLSearchParams(location.search).get('tab') || ls('gn_tab') || 'task';
var taskFilter = 'me';
var adminPin = '', adminStaff = null;
var busy = false;

var $app = document.getElementById('app');
var $tabs = document.getElementById('tabs');

/* ───── 道具 ───── */
function ls(k, v) {
  try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { }
  return '';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pad(n) { return String(n).padStart(2, '0'); }
function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function md(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
function mdKey(k) { var p = k.split('-').map(Number); return md(new Date(p[0], p[1] - 1, p[2]).getTime()); }
function whenLabel(ms) {
  var t = dkey(new Date()), d = dkey(new Date(ms)), tm = dkey(new Date(Date.now() + 864e5)), ye = dkey(new Date(Date.now() - 864e5));
  var pre = d === t ? '今日' : d === tm ? '明日' : d === ye ? '昨日' : md(ms);
  return pre + ' ' + hm(ms);
}
function ago(ms) {
  var m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'たった今'; if (m < 60) return m + '分前';
  if (m < 60 * 24) return Math.floor(m / 60) + '時間前';
  return md(ms);
}
function localInput(ms) { var d = new Date(ms); return dkey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function san(n) { n = String(n || ''); return /(さん|様|ちゃん|くん|君|社長)$/.test(n) ? n : n + 'さん'; }
function nameOf(id) { var s = S && S.staff.filter(function (x) { return x.id === id; })[0]; return s ? s.name : '（退職した人）'; }
function photoUrl(id) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1000'; }
function isStandalone() { return window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

function toast(msg) {
  document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
  var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
}

function api(a, data) {
  var body = Object.assign({ a: a, code: code, me: me }, data || {});
  return fetch(CFG.gasUrl, { method: 'POST', body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .catch(function () { return { ok: false, error: '通信できませんでした。電波を確認してください', net: true }; });
}

/** 操作ボタン共通：送信中は二重押しを防ぎ、結果で画面を更新 */
function act(a, data, okMsg) {
  if (busy) return Promise.resolve(null);
  busy = true; document.body.style.cursor = 'progress';
  return api(a, data).then(function (res) {
    busy = false; document.body.style.cursor = '';
    if (res.badCode || res.badMe) { logout(); return null; }
    if (!res.ok) { toast(res.error || 'うまくいきませんでした'); return null; }
    if (res.tasks) { S = res; render(); }
    if (okMsg) toast(okMsg);
    return res;
  });
}

/* 写真：撮影 → 縮小 → base64 */
function takePhoto() {
  return new Promise(function (resolve) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return resolve(null);
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('写真を読み込めませんでした'); resolve(null); };
      img.src = url;
    };
    inp.click();
  });
}

/* ───── 下から出るシート ───── */
function openSheet(title, html, onMount) {
  closeSheet();
  var bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="bar"><h2>' + esc(title) + '</h2><button class="btn ghost small" data-close>閉じる</button></div>' + html + '</div>';
  bg.addEventListener('click', function (e) { if (e.target === bg || e.target.hasAttribute('data-close')) closeSheet(); });
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(bg.querySelector('.sheet'));
}
function closeSheet() { var s = document.getElementById('sheet'); if (s) s.remove(); document.body.style.overflow = ''; }

/* ───── 起動 ───── */
function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
  if (!CFG.gasUrl) {
    $app.innerHTML = '<div class="center"><h2>準備中です</h2><p class="muted">まだGoogle側の設定が終わっていません。社長に連絡してください。</p></div>';
    return;
  }
  var setupToken = (location.hash.match(/setup=([\w-]+)/) || [])[1];
  api('boot').then(function (res) {
    if (!res.ok) return showError(res.error);
    if (!res.initialized) return setupToken ? showInit(setupToken) : showError('まだ初期設定がされていません。社長に連絡してください。');
    if (setupToken) history.replaceState(null, '', location.pathname);
    if (!code || !me) return showLogin();
    refresh(true);
  });
}

function showError(msg) {
  $tabs.hidden = true;
  $app.innerHTML = '<div class="center"><h2>うまく開けませんでした</h2><p class="muted">' + esc(msg || '') + '</p><button class="btn primary" onclick="location.reload()">もう一度読み込む</button></div>';
}

function showInit(token) {
  $tabs.hidden = true;
  $app.innerHTML =
    '<div class="center"><div class="brand"><small>株式会社もがみ</small><h1>現場ノート 初期設定</h1></div>' +
    '<p class="muted small">最初の1回だけです。社長が入力してください。</p>' +
    '<div class="field"><label for="iName">あなたのお名前</label><input id="iName" placeholder="例：えり"></div>' +
    '<div class="field"><label for="iCode">チームコード（社員に教える合言葉・4文字以上）</label><input id="iCode" autocomplete="off" placeholder="例：unagi2026"></div>' +
    '<div class="field"><label for="iPin">管理用の暗証番号（社長だけが知る数字4〜8桁）</label><input id="iPin" inputmode="numeric" autocomplete="off" placeholder="例：0721"></div>' +
    '<p class="err" id="iErr" hidden></p><button class="btn primary" id="iGo">はじめる</button></div>';
  document.getElementById('iGo').onclick = function () {
    var c = document.getElementById('iCode').value.trim();
    api('init', { token: token, code: c, pin: document.getElementById('iPin').value.trim(), name: document.getElementById('iName').value }).then(function (res) {
      if (!res.ok) { var e = document.getElementById('iErr'); e.hidden = false; e.textContent = res.error; return; }
      code = c; me = res.me; ls('gn_code', code); ls('gn_me', me);
      history.replaceState(null, '', location.pathname);
      tab = 'set'; refresh(true);
    });
  };
}

function showLogin(staff) {
  $tabs.hidden = true;
  if (!staff) {
    $app.innerHTML =
      '<div class="center"><div class="brand"><small>株式会社もがみ</small><h1>現場ノート</h1></div>' +
      '<div class="field"><label for="lCode">チームコード</label><input id="lCode" autocomplete="off" value="' + esc(code) + '" placeholder="社長から聞いた合言葉"></div>' +
      '<p class="err" id="lErr" hidden></p><button class="btn primary" id="lGo">次へ</button></div>';
    document.getElementById('lGo').onclick = function () {
      code = document.getElementById('lCode').value.trim();
      api('login').then(function (res) {
        if (!res.ok) { var e = document.getElementById('lErr'); e.hidden = false; e.textContent = res.error; return; }
        ls('gn_code', code); showLogin(res.staff);
      });
    };
    return;
  }
  $app.innerHTML = '<div class="center"><h2>あなたの名前を選んでください</h2>' +
    (staff.length ? '<div class="namebtns">' + staff.map(function (s) { return '<button class="btn" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>'; }).join('') + '</div>'
      : '<p class="empty">まだ社員が登録されていません。社長に登録してもらってください。</p>') +
    '<button class="btn ghost" id="lBack">チームコードを入れ直す</button></div>';
  $app.querySelectorAll('.namebtns .btn').forEach(function (b) {
    b.onclick = function () { me = b.dataset.id; ls('gn_me', me); refresh(true); };
  });
  document.getElementById('lBack').onclick = function () { showLogin(); };
}

function logout() { me = ''; ls('gn_me', null); S = null; adminPin = ''; showLogin(); }

function refresh(first) {
  if (first) $app.innerHTML = '<div class="center"><div class="spin"></div></div>';
  return api('state').then(function (res) {
    if (res.badCode) { code = ''; ls('gn_code', null); return logout(); }
    if (res.badMe) return logout();
    if (!res.ok) { if (first) showError(res.error); else if (!res.net) toast(res.error); return; }
    S = res; render();
    if (first) syncPush();
  });
}

/* ───── 通知 ───── */
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function b64ToBytes(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a;
}
function subscribePush() {
  return navigator.serviceWorker.ready.then(function (reg) {
    return reg.pushManager.getSubscription().then(function (sub) {
      return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublic) });
    });
  }).then(function (sub) { return api('subscribe', { sub: sub.toJSON() }); });
}
function enablePush() {
  if (!pushSupported()) { toast('このブラウザでは通知が使えません'); return; }
  Notification.requestPermission().then(function (p) {
    if (p !== 'granted') { toast('通知が許可されませんでした'); render(); return; }
    subscribePush().then(function (res) {
      if (res && res.ok) { S = res; render(); toast('通知をオンにしました'); }
      else toast((res && res.error) || '通知の登録に失敗しました');
    }).catch(function () { toast('通知の登録に失敗しました'); });
  });
}
/** 起動時：許可済みなら登録を最新に保つ（1日1回） */
function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  var k = 'gn_push_' + me, today = dkey(new Date());
  if (ls(k) === today && S.me.subs) return;
  subscribePush().then(function (res) { if (res && res.ok) { ls(k, today); S = res; render(); } }).catch(function () { });
}
function pushBanner() {
  if (isIOS() && !isStandalone()) {
    return '<div class="banner warn"><b>ホーム画面に追加してください</b><span>下の共有ボタン（□に↑）→「ホーム画面に追加」。追加したアイコンから開くと、通知が届くようになります。</span></div>';
  }
  if (!pushSupported()) return '<div class="banner info">この端末では通知が使えません。</div>';
  if (Notification.permission === 'denied') return '<div class="banner warn"><b>通知がオフになっています</b><span>iPhoneの「設定」→「通知」→「現場ノート」でオンにしてください。</span></div>';
  if (Notification.permission !== 'granted' || !S.me.subs) {
    return '<div class="banner warn"><b>通知がまだオフです</b><span>オンにすると、アプリを閉じていても期限や連絡が届きます。</span><button class="btn tare" data-act="push">通知をオンにする</button></div>';
  }
  return '';
}

/* ───── 描画 ───── */
function render() {
  if (!S) return;
  $tabs.hidden = false;
  $tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
  var badge = counts();
  setDot('task', badge.task); setDot('clean', badge.clean); setDot('notice', badge.notice);
  if (navigator.setAppBadge) { try { navigator.setAppBadge(badge.task + badge.clean); } catch (e) { } }

  var html = '<header class="top"><div class="brand"><small>株式会社もがみ</small><h1>現場ノート</h1></div>' +
    '<div class="who">入力する人<br><b>' + esc(S.me.name) + '</b></div></header>';
  if (tab !== 'set') html += pushBanner();
  html += ({ task: viewTask, clean: viewClean, notice: viewNotice, point: viewPoint, set: viewSet }[tab] || viewTask)();
  $app.innerHTML = html;
}
function setDot(t, n) {
  var d = $tabs.querySelector('[data-tab="' + t + '"] .dot');
  d.hidden = !n; d.textContent = n > 9 ? '9+' : n;
}
function counts() {
  var now = Date.now();
  var task = S.tasks.filter(function (t) { return !t.done && t.assignees.indexOf(S.me.id) >= 0 && t.due < now; }).length;
  var clean = todayZones().filter(function (z) { return z.owner === S.me.id && !z.log; }).length;
  var notice = S.notices.filter(function (n) { return n.day === S.today && n.notifyAt <= now; }).length;
  return { task: task, clean: clean, notice: notice };
}

/* やること */
function taskState(t) {
  if (t.done) return { cls: 'okc', pill: '<span class="pill ok">完了</span>' };
  var left = t.due - Date.now();
  if (left < 0) return { cls: 'late', pill: '<span class="pill late">期限切れ</span>' };
  if (left < 2 * 3600e3) return { cls: 'soon', pill: '<span class="pill soon">もうすぐ</span>' };
  return { cls: 'idle', pill: '' };
}
function repeatLabel(r) {
  if (!r || r.type === 'none') return '';
  if (r.type === 'daily') return '毎日';
  if (r.type === 'monthly') return '毎月';
  return '毎週' + r.days.slice().sort().map(function (d) { return WD[d]; }).join('');
}
function stampsFor(type, id) {
  var list = S.stamps.filter(function (s) { return s.targetType === type && s.targetId === id; });
  if (!list.length) return '';
  return '<div class="chips">' + list.map(function (s) {
    var st = STAMP[s.stamp] || STAMPS[0];
    return '<span class="got" style="background:' + st.bg + '">' + st.em + ' ' + esc(nameOf(s.from)) + '→' + esc(nameOf(s.to)) + '</span>';
  }).join('') + '</div>';
}
function viewTask() {
  var now = Date.now(), mid = S.me.id;
  var open = S.tasks.filter(function (t) { return !t.done; }).sort(function (a, b) { return a.due - b.due; });
  var mineLate = open.filter(function (t) { return t.assignees.indexOf(mid) >= 0 && t.due < now; }).length;
  var mineToday = open.filter(function (t) { return t.assignees.indexOf(mid) >= 0 && dkey(new Date(t.due)) === dkey(new Date()); }).length;
  var asked = open.filter(function (t) { return t.by === mid && t.assignees.join() !== mid; }).length;
  var shown = open.filter(function (t) {
    if (taskFilter === 'me') return t.assignees.indexOf(mid) >= 0;
    if (taskFilter === 'asked') return t.by === mid;
    return true;
  });
  var done = S.tasks.filter(function (t) { return t.done; }).sort(function (a, b) { return b.doneAt - a.doneAt; }).slice(0, 30);

  return '<div class="stats">' +
    '<div class="stat' + (mineLate ? ' alert' : '') + '"><b>' + mineLate + '</b><span>自分の期限切れ</span></div>' +
    '<div class="stat"><b>' + mineToday + '</b><span>自分の今日の分</span></div>' +
    '<div class="stat"><b>' + asked + '</b><span>人に頼んだ分</span></div></div>' +
    '<button class="btn primary" data-act="newTask">＋「あとで」を登録する</button>' +
    '<div class="seg">' + [['me', '自分の分'], ['all', '全員'], ['asked', '自分が頼んだ']].map(function (f) {
      return '<button data-act="taskFilter" data-f="' + f[0] + '" aria-pressed="' + (taskFilter === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="list">' + (shown.length ? shown.map(taskItem).join('') : '<div class="empty">今はありません 👏</div>') + '</div>' +
    '<details><summary>完了したもの（最近）</summary><div class="list">' + (done.length ? done.map(taskItem).join('') : '<div class="empty">まだありません</div>') + '</div></details>';
}
function taskItem(t) {
  var st = taskState(t), mid = S.me.id, mine = t.assignees.indexOf(mid) >= 0;
  var meta = '<span>担当：' + t.assignees.map(nameOf).map(esc).join('・') + '</span>' +
    (t.done ? '<span>' + esc(nameOf(t.doneBy)) + 'が ' + whenLabel(t.doneAt) + ' に完了</span>' : '<span>期限：' + whenLabel(t.due) + '</span>') +
    '<span>頼んだ人：' + esc(nameOf(t.by)) + '</span>';
  var rep = repeatLabel(t.repeat);
  var btns = '';
  if (!t.done) {
    btns += '<button class="btn small primary" data-act="done" data-id="' + t.id + '">✓ 完了</button>';
    if (t.assignees.some(function (a) { return a !== mid; })) btns += '<button class="btn small" data-act="nudge" data-id="' + t.id + '">📣 催促</button>';
  } else if (t.doneBy !== mid) {
    btns += '<button class="btn small" data-act="stampTo" data-type="task" data-id="' + t.id + '" data-to="' + t.doneBy + '">💌 スタンプ</button>';
  }
  if (t.by === mid || S.me.boss) btns += '<button class="btn small ghost" data-act="delTask" data-id="' + t.id + '">消す</button>';
  return '<div class="item ' + st.cls + (mine && !t.done ? ' mine' : '') + '"><div class="head"><div class="title">' + esc(t.title) + '</div><div class="chips">' + st.pill +
    (rep ? '<span class="pill tare">🔁 ' + rep + '</span>' : '') + '</div></div>' +
    (t.note ? '<p class="small">' + esc(t.note) + '</p>' : '') + '<div class="meta">' + meta + '</div>' + stampsFor('task', t.id) +
    '<div class="actions">' + btns + '</div></div>';
}
function newTaskSheet() {
  var mid = S.me.id;
  var defDue = new Date(Date.now() + 3600e3); defDue.setMinutes(Math.ceil(defDue.getMinutes() / 5) * 5, 0, 0);
  var html =
    '<div class="field"><label for="tWhat">何を</label><input id="tWhat" placeholder="例：冷蔵庫の温度を記録する"></div>' +
    '<div class="field"><span class="lab">誰が（複数OK）</span><div class="chips" id="tWho">' + S.staff.map(function (s) {
      return '<button type="button" class="chip" data-id="' + s.id + '" aria-pressed="' + (s.id === mid) + '">' + esc(s.name) + '</button>';
    }).join('') + '</div></div>' +
    '<div class="field"><label for="tDue">いつまで</label><input id="tDue" type="datetime-local" value="' + localInput(defDue.getTime()) + '">' +
    '<div class="seg" id="tQuick"><button type="button" data-h="0.5">30分後</button><button type="button" data-h="1">1時間後</button><button type="button" data-h="3">3時間後</button><button type="button" data-h="today">今日中</button><button type="button" data-h="tmr">明日の朝</button></div></div>' +
    '<div class="field"><label for="tRemind">前もって知らせる</label><select id="tRemind"><option value="0">期限の時だけ</option><option value="15">15分前にも</option><option value="30" selected>30分前にも</option><option value="60">1時間前にも</option><option value="180">3時間前にも</option></select></div>' +
    '<div class="field"><label for="tRep">繰り返し</label><select id="tRep"><option value="none">なし</option><option value="daily">毎日</option><option value="weekly">毎週（曜日を選ぶ）</option><option value="monthly">毎月</option></select>' +
    '<div class="chips" id="tDays" hidden>' + WD.map(function (w, i) { return '<button type="button" class="chip" data-d="' + i + '" aria-pressed="false">' + w + '</button>'; }).join('') + '</div></div>' +
    '<div class="field"><label for="tNote">メモ（任意）</label><textarea id="tNote" placeholder="例：終わったらホワイトボードにも書く"></textarea></div>' +
    '<p class="small muted">期限の時・1時間たっても終わっていない時に、担当と頼んだ人へ通知が届きます。</p>' +
    '<p class="err" id="tErr" hidden></p><button class="btn primary" id="tGo">登録する</button>';
  openSheet('「あとで」を登録', html, function (sh) {
    var q = function (s) { return sh.querySelector(s); };
    sh.querySelectorAll('#tWho .chip, #tDays .chip').forEach(function (c) {
      c.onclick = function () { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); };
    });
    q('#tRep').onchange = function () { q('#tDays').hidden = q('#tRep').value !== 'weekly'; };
    sh.querySelectorAll('#tQuick button').forEach(function (b) {
      b.onclick = function () {
        var d = new Date();
        if (b.dataset.h === 'today') d.setHours(23, 59, 0, 0);
        else if (b.dataset.h === 'tmr') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
        else { d = new Date(Date.now() + Number(b.dataset.h) * 3600e3); d.setSeconds(0, 0); }
        q('#tDue').value = localInput(d.getTime());
      };
    });
    q('#tGo').onclick = function () {
      var who = [].map.call(sh.querySelectorAll('#tWho .chip[aria-pressed=true]'), function (c) { return c.dataset.id; });
      var days = [].map.call(sh.querySelectorAll('#tDays .chip[aria-pressed=true]'), function (c) { return Number(c.dataset.d); });
      var due = new Date(q('#tDue').value).getTime();
      var err = !q('#tWhat').value.trim() ? '「何を」を入れてください' : !who.length ? '担当を選んでください' : !due ? '期限を入れてください' : '';
      if (err) { q('#tErr').hidden = false; q('#tErr').textContent = err; return; }
      act('addTask', { title: q('#tWhat').value, note: q('#tNote').value, assignees: who, due: due, remind: Number(q('#tRemind').value), repeat: { type: q('#tRep').value, days: days } }, '登録しました')
        .then(function (r) { if (r) closeSheet(); });
    };
  });
}

/* 掃除 */
function todayZones() {
  return S.zones.map(function (z) {
    var log = S.cleanlogs.filter(function (l) { return l.zoneId === z.id && l.day === S.today; })[0] || null;
    var on = (z.days || []).indexOf(S.todayDow) >= 0;
    return Object.assign({}, z, { log: log, on: on });
  });
}
function deadlineMs(z) { var p = S.today.split('-').map(Number), h = (z.deadline || '10:00').split(':').map(Number); return new Date(p[0], p[1] - 1, p[2], h[0], h[1]).getTime(); }
function viewClean() {
  var mid = S.me.id, zones = todayZones();
  var mine = zones.filter(function (z) { return z.owner === mid; }), others = zones.filter(function (z) { return z.owner !== mid; });
  var toCheck = S.cleanlogs.filter(function (l) { return !l.review && l.by !== mid; });
  var pick = S.pickups.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, 8);
  return '<div><h2>今日の掃除</h2><p class="muted small">' + mdKey(S.today) + '　完了は写真で報告します</p></div>' +
    '<button class="big-pick" data-act="pickup"><span class="em">🫳</span><span><b>落ちてた！拾った！</b><span>ゴムや資材を拾ったら写真で記録 → 1ポイント</span></span></button>' +
    (toCheck.length ? '<h3>チェック待ち（' + toCheck.length + '）— あなたが見てOK／NG</h3><div class="list">' + toCheck.map(function (l) { return logItem(l, true); }).join('') + '</div>' : '') +
    '<h3>あなたの担当</h3><div class="list">' + (mine.length ? mine.map(zoneItem).join('') : '<div class="empty">担当の場所はありません</div>') + '</div>' +
    (others.length ? '<h3>ほかの場所</h3><div class="list">' + others.map(zoneItem).join('') + '</div>' : '') +
    (S.zones.length ? '' : '<div class="empty">まだ掃除の場所が登録されていません。社長が「設定」から登録します。</div>') +
    '<details><summary>最近拾ったもの</summary><div class="list">' + (pick.length ? pick.map(pickItem).join('') : '<div class="empty">まだありません</div>') + '</div></details>' +
    '<details><summary>この1週間の掃除の記録</summary><div class="list">' + (S.cleanlogs.length ? S.cleanlogs.slice().sort(function (a, b) { return b.at - a.at; }).map(function (l) { return logItem(l, false); }).join('') : '<div class="empty">まだありません</div>') + '</div></details>';
}
function zoneItem(z) {
  var mid = S.me.id, late = z.on && !z.log && Date.now() > deadlineMs(z);
  var cls = !z.on ? 'idle' : z.log ? 'okc' : late ? 'late' : 'soon';
  var pill = !z.on ? '<span class="pill idle">今日はお休み</span>' : z.log ? '<span class="pill ok">完了</span>' : late ? '<span class="pill late">期限切れ</span>' : '<span class="pill soon">まだ</span>';
  var body = '<div class="meta"><span>担当：' + (z.owner ? esc(nameOf(z.owner)) : '未定') + '</span><span>' + (z.deadline || '10:00') + 'まで</span><span>' + (z.days || []).map(function (d) { return WD[d]; }).join('') + '</span></div>';
  if (z.log) {
    body += '<img class="photo" loading="lazy" src="' + photoUrl(z.log.photo) + '" alt="' + esc(z.name) + 'の完了写真">' +
      '<div class="meta"><span>' + esc(nameOf(z.log.by)) + 'が ' + hm(z.log.at) + ' に完了</span>' + reviewLabel(z.log) + '</div>' + stampsFor('clean', z.log.id);
    var b = '';
    if (!z.log.review && z.log.by !== mid) b += '<button class="btn small primary" data-act="rvOk" data-id="' + z.log.id + '">👌 OK</button><button class="btn small danger" data-act="rvNg" data-id="' + z.log.id + '">NG</button>';
    if (z.log.by !== mid) b += '<button class="btn small" data-act="stampTo" data-type="clean" data-id="' + z.log.id + '" data-to="' + z.log.by + '">💌 スタンプ</button>';
    if (b) body += '<div class="actions">' + b + '</div>';
  } else if (z.on) {
    body += '<button class="btn ' + (z.owner === mid ? 'primary' : '') + ' wide" data-act="cleanDone" data-id="' + z.id + '">📷 写真を撮って完了' + (z.owner === mid ? '' : '（代わりにやった）') + '</button>';
  }
  return '<div class="item ' + cls + '"><div class="head"><div class="title">' + esc(z.name) + '</div>' + pill + '</div>' + body + '</div>';
}
function reviewLabel(l) {
  if (!l.review) return '<span>チェック待ち</span>';
  return l.review.ok ? '<span>👌 ' + esc(nameOf(l.review.by)) + 'がOK</span>' : '<span style="color:var(--danger)">⚠️ ' + esc(nameOf(l.review.by)) + 'がNG：' + esc(l.review.comment) + '</span>';
}
function logItem(l, actions) {
  var mid = S.me.id;
  var b = actions ? '<div class="actions"><button class="btn small primary" data-act="rvOk" data-id="' + l.id + '">👌 OK</button><button class="btn small danger" data-act="rvNg" data-id="' + l.id + '">NG（やり直し）</button></div>' : '';
  return '<div class="item ' + (l.review ? (l.review.ok ? 'okc' : 'late') : 'soon') + '"><div class="head"><div class="title">' + esc(l.zoneName) + '</div><span class="pill idle">' + mdKey(l.day) + '</span></div>' +
    '<img class="photo" loading="lazy" src="' + photoUrl(l.photo) + '" alt="完了写真">' +
    '<div class="meta"><span>' + esc(nameOf(l.by)) + 'が ' + hm(l.at) + ' に完了</span>' + reviewLabel(l) + '</div>' + stampsFor('clean', l.id) + (l.by === mid ? '' : b) + '</div>';
}
function pickItem(p) {
  return '<div class="item okc"><div class="head" style="align-items:center"><img class="thumb" loading="lazy" src="' + photoUrl(p.photo) + '" alt="拾ったもの">' +
    '<div style="flex:1;min-width:0"><div class="title">' + esc(nameOf(p.by)) + 'が拾った</div><div class="meta"><span>' + ago(p.at) + '</span>' + (p.note ? '<span>' + esc(p.note) + '</span>' : '') + '</div></div>' +
    (p.by !== S.me.id ? '<button class="btn small" data-act="stampTo" data-type="pickup" data-id="' + p.id + '" data-to="' + p.by + '">💌</button>' : '') + '</div>' + stampsFor('pickup', p.id) + '</div>';
}
function cleanDone(id) {
  takePhoto().then(function (photo) { if (photo) act('cleanDone', { zoneId: id, photo: photo }, '完了！おつかれさまです ✨'); });
}
function pickup() {
  takePhoto().then(function (photo) {
    if (!photo) return;
    openSheet('拾ったものを記録', '<img class="photo" src="' + photo + '" alt="">' +
      '<div class="field"><label for="pNote">何を拾った？（任意）</label><input id="pNote" placeholder="例：ゴム3本、加工場の床"></div>' +
      '<button class="btn primary" id="pGo">記録する（1ポイント）</button>', function (sh) {
      sh.querySelector('#pGo').onclick = function () {
        act('pickup', { photo: photo, note: sh.querySelector('#pNote').value }, 'ナイス！ +1ポイント').then(function (r) { if (r) closeSheet(); });
      };
    });
  });
}
function reviewNg(id) {
  openSheet('NG（やり直し）', '<div class="field"><label for="ngWhy">どこがダメ？（担当に通知されます）</label><textarea id="ngWhy" placeholder="例：床にゴムが残っている"></textarea></div><button class="btn primary" id="ngGo">NGを送る</button>', function (sh) {
    sh.querySelector('#ngGo').onclick = function () {
      act('review', { logId: id, ok: false, comment: sh.querySelector('#ngWhy').value }, 'NGを送りました').then(function (r) { if (r) closeSheet(); });
    };
  });
}

/* 連絡 */
function viewNotice() {
  var now = Date.now();
  var list = S.notices.slice().sort(function (a, b) { return b.day < a.day ? -1 : b.day > a.day ? 1 : b.at - a.at; });
  var upcoming = list.filter(function (n) { return n.day >= S.today; }), past = list.filter(function (n) { return n.day < S.today; });
  function item(n) {
    var cls = n.type === '欠勤' ? 'late' : n.type === '遅刻' || n.type === '早退' ? 'soon' : 'idle';
    return '<div class="item ' + cls + '"><div class="head"><div class="title">' + esc(n.type) + '：' + esc(nameOf(n.from)) + '</div><span class="pill ' + (n.day === S.today ? 'late' : 'idle') + '">' + (n.day === S.today ? '今日' : mdKey(n.day)) + '</span></div>' +
      (n.message ? '<p>' + esc(n.message) + '</p>' : '') +
      '<div class="meta"><span>宛先：' + (n.to === 'boss' ? '社長だけ' : '全員') + '</span><span>' + (n.notifyAt > now ? '⏰ ' + whenLabel(n.notifyAt) + ' に通知予定' : '通知済み ' + whenLabel(n.notifyAt)) + '</span></div></div>';
  }
  return '<button class="btn primary" data-act="newNotice">＋ 連絡する（欠勤・遅刻など）</button>' +
    '<h3>今日とこれから</h3><div class="list">' + (upcoming.length ? upcoming.map(item).join('') : '<div class="empty">今のところ連絡はありません</div>') + '</div>' +
    (past.length ? '<details><summary>過去の連絡</summary><div class="list">' + past.map(item).join('') + '</div></details>' : '');
}
function newNoticeSheet() {
  var html =
    '<div class="field"><span class="lab">種類</span><div class="chips" id="nType">' + S.noticeTypes.map(function (t, i) {
      return '<button type="button" class="chip" data-v="' + esc(t) + '" aria-pressed="' + (i === 0) + '">' + esc(t) + '</button>';
    }).join('') + '</div></div>' +
    '<div class="field"><label for="nDay">いつの話？</label><input id="nDay" type="date" value="' + S.today + '"></div>' +
    '<div class="field"><label for="nMsg">ひとこと</label><textarea id="nMsg" placeholder="例：熱が出たのでお休みします。明日は出られます"></textarea></div>' +
    '<div class="field"><span class="lab">誰に知らせる？</span><div class="seg" id="nTo"><button type="button" data-v="all" aria-pressed="true">全員</button><button type="button" data-v="boss" aria-pressed="false">社長だけ</button></div></div>' +
    '<div class="field"><span class="lab">いつ通知する？</span><div class="seg" id="nWhen"><button type="button" data-v="now" aria-pressed="true">今すぐ</button><button type="button" data-v="at" aria-pressed="false">日時を指定</button></div>' +
    '<input id="nAt" type="datetime-local" hidden value="' + localInput(Date.now() + 3600e3) + '"></div>' +
    '<p class="small muted">通知は数分以内に届きます。</p><p class="err" id="nErr" hidden></p><button class="btn primary" id="nGo">送る</button>';
  openSheet('連絡する', html, function (sh) {
    function single(sel) {
      sh.querySelectorAll(sel + ' button').forEach(function (b) {
        b.onclick = function () { sh.querySelectorAll(sel + ' button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); if (sel === '#nWhen') sh.querySelector('#nAt').hidden = b.dataset.v !== 'at'; };
      });
    }
    single('#nType'); single('#nTo'); single('#nWhen');
    sh.querySelector('#nGo').onclick = function () {
      var pick = function (sel) { return sh.querySelector(sel + ' [aria-pressed=true]').dataset.v; };
      var at = pick('#nWhen') === 'at' ? new Date(sh.querySelector('#nAt').value).getTime() : Date.now();
      if (!at) { var e = sh.querySelector('#nErr'); e.hidden = false; e.textContent = '通知する日時を入れてください'; return; }
      act('addNotice', { type: pick('#nType'), day: sh.querySelector('#nDay').value, message: sh.querySelector('#nMsg').value, to: pick('#nTo'), notifyAt: at }, '送りました')
        .then(function (r) { if (r) closeSheet(); });
    };
  });
}

/* ポイント・スタンプ */
function viewPoint() {
  var rows = S.staff.map(function (s) {
    var p = S.points[s.id] || { clean: 0, pickup: 0, review: 0, stamp: 0 };
    return { s: s, p: p, total: p.clean + p.pickup + p.review };
  }).sort(function (a, b) { return b.total - a.total || b.p.stamp - a.p.stamp; });
  var got = S.stamps.filter(function (s) { return s.to === S.me.id; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 20);
  var month = Number(S.today.slice(5, 7));
  var rank = 0, prev = null;
  return '<div><h2>' + month + '月のポイント</h2><p class="muted small">掃除完了・拾った・チェックで1ポイントずつ</p></div>' +
    '<div class="card">' + rows.map(function (r, i) {
      if (prev === null || r.total !== prev) rank = i + 1; prev = r.total;
      return '<div class="rank' + (rank === 1 && r.total ? ' top' : '') + '"><span class="no">' + rank + '</span><div class="nm">' + esc(r.s.name) +
        '<div class="small muted">🧹' + r.p.clean + '　🫳' + r.p.pickup + '　👀' + r.p.review + '　💌' + r.p.stamp + '</div></div><span class="pt">' + r.total + '</span></div>';
    }).join('') + '</div>' +
    '<button class="btn tare" data-act="stampTo" data-type="person" data-id="">💌 だれかにスタンプを送る</button>' +
    '<h3>あなたがもらったスタンプ</h3><div class="list">' + (got.length ? got.map(function (s) {
      var st = STAMP[s.stamp] || STAMPS[0];
      return '<div class="item okc"><div class="head" style="align-items:center"><span class="got" style="background:' + st.bg + ';font-size:15px;padding:6px 14px">' + st.em + ' ' + st.label + '</span><span class="small muted">' + esc(nameOf(s.from)) + '　' + ago(s.at) + '</span></div></div>';
    }).join('') : '<div class="empty">まだありません</div>') + '</div>';
}
function stampSheet(type, id, to) {
  var people = S.staff.filter(function (s) { return s.id !== S.me.id; });
  var html = (to ? '<p>' + esc(nameOf(to)) + 'さんに送ります</p>' :
    '<div class="field"><label for="sTo">だれに？</label><select id="sTo">' + people.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</select></div>') +
    '<div class="stamps">' + STAMPS.map(function (s) {
      return '<button type="button" class="stampbtn" data-k="' + s.k + '" style="background:' + s.bg + '"><span class="em">' + s.em + '</span>' + s.label + '</button>';
    }).join('') + '</div><p class="small muted">押すとすぐに送られます。</p>';
  openSheet('スタンプを送る', html, function (sh) {
    sh.querySelectorAll('.stampbtn').forEach(function (b) {
      b.onclick = function () {
        var target = to || sh.querySelector('#sTo').value;
        act('stamp', { targetType: type, targetId: id, to: target, stamp: b.dataset.k }, STAMP[b.dataset.k].em + ' 送りました').then(function (r) { if (r) closeSheet(); });
      };
    });
  });
}

/* 設定 */
function viewSet() {
  var notif;
  if (isIOS() && !isStandalone()) notif = '<span class="pill soon">ホーム画面から開くと使えます</span>';
  else if (!pushSupported()) notif = '<span class="pill idle">この端末は非対応</span>';
  else if (Notification.permission === 'granted' && S.me.subs) notif = '<span class="pill ok">オン</span>';
  else if (Notification.permission === 'denied') notif = '<span class="pill late">オフ（iPhoneの設定から）</span>';
  else notif = '<span class="pill soon">オフ</span>';
  var html = '<h2>設定</h2>' + pushBanner() +
    '<div class="card"><h3>あなた</h3><div class="head" style="align-items:center"><b style="font-size:18px">' + esc(S.me.name) + (S.me.boss ? '（社長）' : '') + '</b><button class="btn small ghost" data-act="logout">名前を選び直す</button></div>' +
    '<div class="head" style="align-items:center"><span>通知</span>' + notif + '</div>' +
    (pushSupported() && Notification.permission === 'granted' && S.me.subs ? '<button class="btn small" data-act="testPush">テスト通知を送る（数分で届きます）</button>' : '') + '</div>';
  if (S.me.boss) html += adminPanel();
  html += '<details class="card"><summary>使い方</summary><div class="small" style="display:flex;flex-direction:column;gap:6px">' +
    '<p>📝 <b>やること</b>：「あとで」と思ったらすぐ登録。期限に通知、1時間過ぎても終わらないと頼んだ人にも通知。</p>' +
    '<p>🧹 <b>掃除</b>：担当の場所は写真を撮って完了。ほかの人の掃除は見てOK／NG。NGは担当に通知されます。</p>' +
    '<p>🫳 <b>拾った</b>：落ちているゴムや資材を拾ったら写真で記録。1ポイント。</p>' +
    '<p>📢 <b>連絡</b>：欠勤・遅刻などは全員か社長に。日時を指定して送ることもできます。</p>' +
    '<p>💌 <b>スタンプ</b>：完了したやること・掃除・拾ったものに送れます。</p></div></details>';
  return html;
}
function adminPanel() {
  if (!adminPin) {
    return '<div class="card"><h3>管理（社長だけ）</h3><p class="small muted">社員・掃除の場所の登録や担当の入れ替えができます。</p>' +
      '<div class="row2"><input id="aPin" inputmode="numeric" type="password" placeholder="暗証番号"><button class="btn" data-act="adminOpen">開く</button></div></div>';
  }
  var staff = adminStaff || [];
  var zones = S.zones;
  return '<div class="card"><div class="head"><h3>社員（' + staff.filter(function (s) { return s.active; }).length + '人）</h3><button class="btn small ghost" data-act="adminClose">管理を閉じる</button></div>' +
    '<table class="mini">' + staff.map(function (s) {
      return '<tr><td><b' + (s.active ? '' : ' style="color:var(--muted);text-decoration:line-through"') + '>' + esc(s.name) + '</b>' + (s.boss ? ' <span class="pill tare">社長</span>' : '') + '</td><td style="text-align:right;white-space:nowrap">' +
        '<button class="btn small ghost" data-act="staffRename" data-id="' + s.id + '">名前</button> ' +
        (s.active ? '<button class="btn small danger" data-act="staffOff" data-id="' + s.id + '">退職</button>' : '<button class="btn small" data-act="staffOn" data-id="' + s.id + '">戻す</button>') + '</td></tr>';
    }).join('') + '</table>' +
    '<div class="row2"><input id="aName" placeholder="新しい社員の名前"><button class="btn" data-act="staffAdd">追加</button></div></div>' +
    '<div class="card"><div class="head"><h3>掃除の場所（ゾーン）</h3>' + (zones.length > 1 ? '<button class="btn small" data-act="rotate">担当を1つずらす</button>' : '') + '</div>' +
    '<p class="small muted">「担当を1つずらす」は月替わりなどに使います。全員に通知が届きます。</p>' +
    (zones.length ? '<div class="list">' + zones.map(function (z) {
      return '<div class="item idle"><div class="head"><div class="title">' + esc(z.name) + '</div><button class="btn small ghost" data-act="zoneEdit" data-id="' + z.id + '">編集</button></div>' +
        '<div class="meta"><span>担当：' + (z.owner ? esc(nameOf(z.owner)) : '未定') + '</span><span>' + (z.deadline || '10:00') + 'まで</span><span>' + (z.days || []).map(function (d) { return WD[d]; }).join('') + '</span></div></div>';
    }).join('') + '</div>' : '<div class="empty">例：加工場A・資材置き場・トイレ・休憩室・駐車場と車</div>') +
    '<button class="btn" data-act="zoneEdit" data-id="">＋ 場所を追加</button></div>' +
    '<div class="card"><h3>チームコード・暗証番号</h3><div class="row2"><input id="aCode" placeholder="新しいチームコード"><button class="btn" data-act="setCode">変更</button></div>' +
    '<p class="small muted">チームコードを変えると、全員が入れ直しになります（退職者を締め出すときに）。</p>' +
    '<div class="row2"><input id="aNewPin" inputmode="numeric" placeholder="新しい暗証番号"><button class="btn" data-act="setPin">変更</button></div></div>';
}
function admin(op, data, msg) {
  return act('admin', Object.assign({ pin: adminPin, op: op }, data || {}), msg).then(function (r) {
    if (r && r.allStaff) { adminStaff = r.allStaff; render(); }
    return r;
  });
}
function zoneSheet(id) {
  var z = S.zones.filter(function (x) { return x.id === id; })[0] || { name: '', owner: '', days: [0, 1, 2, 3, 4, 5, 6], deadline: '10:00' };
  var html = '<div class="field"><label for="zName">場所の名前</label><input id="zName" value="' + esc(z.name) + '" placeholder="例：トイレ"></div>' +
    '<div class="field"><label for="zOwner">担当</label><select id="zOwner"><option value="">未定</option>' + S.staff.map(function (s) { return '<option value="' + s.id + '"' + (s.id === z.owner ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><span class="lab">掃除する曜日</span><div class="chips" id="zDays">' + WD.map(function (w, i) { return '<button type="button" class="chip" data-d="' + i + '" aria-pressed="' + ((z.days || []).indexOf(i) >= 0) + '">' + w + '</button>'; }).join('') + '</div></div>' +
    '<div class="field"><label for="zDl">何時までに終わらせる？</label><input id="zDl" type="time" value="' + esc(z.deadline || '10:00') + '"></div>' +
    '<p class="small muted">この時間を過ぎても完了がないと、担当に通知が届きます。</p>' +
    '<button class="btn primary" id="zGo">保存する</button>' + (id ? '<button class="btn danger" id="zDel">この場所を消す</button>' : '');
  openSheet(id ? '場所を編集' : '場所を追加', html, function (sh) {
    sh.querySelectorAll('#zDays .chip').forEach(function (c) { c.onclick = function () { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); }; });
    sh.querySelector('#zGo').onclick = function () {
      var days = [].map.call(sh.querySelectorAll('#zDays .chip[aria-pressed=true]'), function (c) { return Number(c.dataset.d); });
      if (!days.length) { toast('曜日を1つ以上選んでください'); return; }
      admin(id ? 'setZone' : 'addZone', { id: id, name: sh.querySelector('#zName').value, owner: sh.querySelector('#zOwner').value, days: days, deadline: sh.querySelector('#zDl').value }, '保存しました')
        .then(function (r) { if (r) closeSheet(); });
    };
    var del = sh.querySelector('#zDel');
    if (del) del.onclick = function () {
      if (del.dataset.sure) admin('delZone', { id: id }, '消しました').then(function (r) { if (r) closeSheet(); });
      else { del.dataset.sure = '1'; del.textContent = 'もう一度押すと消えます'; }
    };
  });
}

/* ───── ボタン操作 ───── */
$tabs.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-tab]'); if (!b) return;
  tab = b.dataset.tab; ls('gn_tab', tab); render(); window.scrollTo(0, 0);
});
$app.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]'); if (!b || !S) return;
  var id = b.dataset.id, a = b.dataset.act;
  switch (a) {
    case 'push': enablePush(); break;
    case 'testPush': act('testPush', {}, 'テスト通知を予約しました（数分で届きます）'); break;
    case 'newTask': newTaskSheet(); break;
    case 'taskFilter': taskFilter = b.dataset.f; render(); break;
    case 'done': act('doneTask', { id: id }, 'おつかれさまです ✓'); break;
    case 'nudge': act('nudge', { id: id }, '催促しました'); break;
    case 'delTask':
      if (b.dataset.sure) act('delTask', { id: id }, '消しました');
      else { b.dataset.sure = '1'; b.textContent = 'もう一度で消す'; }
      break;
    case 'cleanDone': cleanDone(id); break;
    case 'rvOk': act('review', { logId: id, ok: true }, 'OKを送りました +1ポイント'); break;
    case 'rvNg': reviewNg(id); break;
    case 'pickup': pickup(); break;
    case 'newNotice': newNoticeSheet(); break;
    case 'stampTo': stampSheet(b.dataset.type, id, b.dataset.to); break;
    case 'logout': logout(); break;
    case 'adminOpen':
      adminPin = (document.getElementById('aPin') || {}).value || '';
      api('admin', { pin: adminPin, op: 'check' }).then(function (r) {
        if (!r.ok) { adminPin = ''; toast(r.error); return; }
        adminStaff = r.allStaff; if (r.tasks) S = r; render();
      });
      break;
    case 'adminClose': adminPin = ''; adminStaff = null; render(); break;
    case 'staffAdd':
      var nm = document.getElementById('aName').value.trim();
      if (!nm) { toast('名前を入れてください'); break; }
      admin('addStaff', { name: nm }, san(nm) + 'を追加しました'); break;
    case 'staffOff': admin('setStaff', { id: id, active: false }, '退職にしました'); break;
    case 'staffOn': admin('setStaff', { id: id, active: true }, '戻しました'); break;
    case 'staffRename':
      var cur = (adminStaff || []).filter(function (s) { return s.id === id; })[0];
      openSheet('名前を変える', '<input id="rnName" value="' + esc(cur ? cur.name : '') + '"><button class="btn primary" id="rnGo">変更する</button>', function (sh) {
        sh.querySelector('#rnGo').onclick = function () { admin('setStaff', { id: id, name: sh.querySelector('#rnName').value }, '変更しました').then(function (r) { if (r) closeSheet(); }); };
      });
      break;
    case 'zoneEdit': zoneSheet(id); break;
    case 'rotate':
      if (b.dataset.sure) admin('rotate', {}, '担当をずらしました');
      else { b.dataset.sure = '1'; b.textContent = 'もう一度で実行'; }
      break;
    case 'setCode':
      var nc = document.getElementById('aCode').value.trim();
      if (nc.length < 4) { toast('4文字以上にしてください'); break; }
      api('admin', { pin: adminPin, op: 'setCode', newCode: nc }).then(function (r) {
        if (!r.ok) return toast(r.error);
        code = nc; ls('gn_code', code); toast('チームコードを変えました'); refresh();
      });
      break;
    case 'setPin':
      var np = document.getElementById('aNewPin').value.trim();
      admin('setPin', { newPin: np }, '暗証番号を変えました').then(function (r) { if (r) adminPin = np; });
      break;
  }
});

document.addEventListener('visibilitychange', function () { if (!document.hidden && S && me) refresh(); });
setInterval(function () { if (!document.hidden && S && me && !document.getElementById('sheet')) refresh(); }, 60000);
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
  if (e.data && e.data.tab) { tab = e.data.tab; if (S) refresh(); }
});

start();
})();
