/**
 * もがみ 現場ノート — Google側のプログラム（データ・写真・通知の予約）
 * このファイルを Apps Script に丸ごと貼り付けて、「ウェブアプリ」として公開してください。
 *   実行するユーザー：自分　／　アクセスできるユーザー：全員
 */

var TZ = 'Asia/Tokyo';
var JST = 9 * 3600 * 1000;
var MIN = 60 * 1000;
var DAY = 24 * 3600 * 1000;
var TABLES = ['staff', 'tasks', 'zones', 'cleanlogs', 'notices', 'pickups', 'stamps', 'subs', 'outbox'];
var STAMPS = {
  thanks: 'ありがとう', saved: '助かった！', great: 'さすが', shiny: 'ピカピカ',
  nice: 'ナイス', please: 'おねがい', otsu: 'おつかれ', best: '最高'
};
var NOTICE_TYPES = ['欠勤', '遅刻', '早退', 'お休み希望', 'その他'];

/* ───────── 入口 ───────── */

function doGet() {
  return json_({ ok: true, app: 'genba-note', initialized: isInit_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: '混み合っています。もう一度お試しください' });
  }
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var res = route_(req);
    flush_();
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(r) {
  var a = r.a;
  if (a === 'boot') return { ok: true, initialized: isInit_() };
  if (a === 'init') return init_(r);
  if (!isInit_()) return { ok: false, error: 'まだ初期設定がされていません' };

  if (a === 'outbox') { checkToken_(r.token); return outbox_(); }
  if (a === 'ack') { checkToken_(r.token); return ack_(r); }

  if (String(r.code || '') !== prop_('TEAM_CODE')) return { ok: false, error: 'チームコードが違います', badCode: true };
  if (a === 'login') return { ok: true, staff: publicStaff_() };

  if (a === 'admin') return admin_(r);

  var me = activeStaff_(r.me);
  if (!me) return { ok: false, error: '名前が登録されていません。選び直してください', badMe: true };

  switch (a) {
    case 'state': return state_(me);
    case 'addTask': return addTask_(me, r);
    case 'doneTask': return doneTask_(me, r);
    case 'delTask': return delTask_(me, r);
    case 'nudge': return nudge_(me, r);
    case 'cleanDone': return cleanDone_(me, r);
    case 'review': return review_(me, r);
    case 'addNotice': return addNotice_(me, r);
    case 'pickup': return pickup_(me, r);
    case 'stamp': return stamp_(me, r);
    case 'subscribe': return subscribe_(me, r);
    case 'testPush':
      enqueue_([me.id], '🔔 テスト通知', '通知はちゃんと届いています', 'task');
      return { ok: true };
  }
  return { ok: false, error: '不明な操作です' };
}

/* ───────── 初期設定 ───────── */

function isInit_() { return !!prop_('TEAM_CODE'); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, String(v)); }

function init_(r) {
  if (isInit_()) return { ok: false, error: 'すでに初期設定済みです' };
  var token = String(r.token || ''), code = String(r.code || '').trim(), pin = String(r.pin || '').trim();
  var name = clip_(r.name, 20);
  if (token.length < 24) return { ok: false, error: '設定用リンクから開いてください' };
  if (code.length < 4) return { ok: false, error: 'チームコードは4文字以上にしてください' };
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: '管理用の暗証番号は4〜8桁の数字にしてください' };
  if (!name) return { ok: false, error: 'お名前を入れてください' };

  var ss = SpreadsheetApp.create('もがみ現場ノート（新データ）');
  var folder = DriveApp.createFolder('もがみ現場ノート 写真');
  setProp_('SHEET_ID', ss.getId());
  setProp_('FOLDER_ID', folder.getId());
  TABLES.forEach(function (t) { sheet_(t); });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  var boss = { id: uid_(), name: name, boss: true, active: true, at: Date.now() };
  T_('staff').put(boss);
  setProp_('SENDER_TOKEN', token);
  setProp_('ADMIN_PIN', pin);
  setProp_('TEAM_CODE', code);
  return { ok: true, me: boss.id, staff: publicStaff_() };
}

function checkToken_(t) {
  if (!t || String(t) !== prop_('SENDER_TOKEN')) throw new Error('送信キーが違います');
}

/* ───────── 表（スプレッドシート）の読み書き ───────── */

var _ss = null, _cache = {};

function ss_() {
  if (!_ss) _ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  return _ss;
}

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'data', 'updated']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function T_(name) {
  if (_cache[name]) return _cache[name];
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  var list = [], index = {};
  rows.forEach(function (row) {
    if (!row[0]) return;
    try {
      var o = JSON.parse(row[1]);
      index[o.id] = list.length;
      list.push(o);
    } catch (e) { /* 壊れた行は読み飛ばす */ }
  });
  var t = {
    list: list,
    dirty: false,
    all: function () { return list.filter(function (x) { return !x._del; }); },
    get: function (id) { var i = index[id]; return i === undefined || list[i]._del ? null : list[i]; },
    put: function (o) {
      var i = index[o.id];
      if (i === undefined) { index[o.id] = list.length; list.push(o); } else { list[i] = o; }
      t.dirty = true;
      return o;
    },
    del: function (id) { var i = index[id]; if (i !== undefined) { list[i]._del = true; t.dirty = true; } }
  };
  _cache[name] = t;
  return t;
}

/** 変更があった表だけ、まとめて書き戻す */
function flush_() {
  Object.keys(_cache).forEach(function (name) {
    var t = _cache[name];
    if (!t.dirty) return;
    var sh = sheet_(name);
    var keep = t.list.filter(function (x) { return !x._del; });
    var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var values = keep.map(function (o) { return [o.id, JSON.stringify(o), now]; });
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
    if (values.length) sh.getRange(2, 1, values.length, 3).setValues(values);
    t.dirty = false;
  });
}

/* ───────── 小さな道具 ───────── */

function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function clip_(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
function dayKey_(ms) { return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd'); }
function dow_(ms) { return Number(Utilities.formatDate(new Date(ms), TZ, 'u')) % 7; }
function hm_(ms) { return Utilities.formatDate(new Date(ms), TZ, 'HH:mm'); }
function md_(ms) {
  var w = ['日', '月', '火', '水', '木', '金', '土'];
  return Utilities.formatDate(new Date(ms), TZ, 'M/d') + '(' + w[dow_(ms)] + ')';
}
function at_(day, hm) { return new Date(day + 'T' + (hm || '00:00') + ':00+09:00').getTime(); }
function nameOf_(id) { var s = T_('staff').get(id); return s ? s.name : '（退職した人）'; }
function san_(n) { n = String(n || ''); return /(さん|様|ちゃん|くん|君|社長)$/.test(n) ? n : n + 'さん'; }

function activeStaff_(id) {
  var s = id ? T_('staff').get(String(id)) : null;
  return s && s.active ? s : null;
}
function publicStaff_() {
  return T_('staff').all().filter(function (s) { return s.active; })
    .map(function (s) { return { id: s.id, name: s.name, boss: !!s.boss }; });
}
function bossIds_() {
  return T_('staff').all().filter(function (s) { return s.active && s.boss; }).map(function (s) { return s.id; });
}
function validIds_(ids) {
  return (Array.isArray(ids) ? ids : []).map(String).filter(function (id) { return !!activeStaff_(id); })
    .filter(function (id, i, a) { return a.indexOf(id) === i; });
}

function savePhoto_(b64, label) {
  if (!b64) return '';
  var data = String(b64).replace(/^data:image\/\w+;base64,/, '');
  if (data.length > 4 * 1024 * 1024) throw new Error('写真が大きすぎます');
  var blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg',
    Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '_' + label + '.jpg');
  var file = DriveApp.getFolderById(prop_('FOLDER_ID')).createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  return file.getId();
}

/** 通知の予約（送信係が5分ごとに取りに来る） */
function enqueue_(to, title, body, tab) {
  var ids = (Array.isArray(to) ? to : [to]).filter(function (id, i, a) { return id && a.indexOf(id) === i; });
  ids.forEach(function (id) {
    T_('outbox').put({ id: uid_(), to: id, title: clip_(title, 80), body: clip_(body, 200), tab: tab || 'task', at: Date.now(), sentAt: 0 });
  });
}

/* ───────── 画面に返すデータ ───────── */

function state_(me) {
  var now = Date.now();
  var today = dayKey_(now);
  var monthKey = today.slice(0, 7);
  var since7 = now - 8 * DAY, since30 = now - 31 * DAY;

  var tasks = T_('tasks').all().filter(function (t) { return !t.done || t.doneAt > since7; });
  var cleanlogs = T_('cleanlogs').all().filter(function (l) { return l.at > since7; });
  var notices = T_('notices').all().filter(function (n) { return n.notifyAt > now - 15 * DAY; });
  var pickups = T_('pickups').all().filter(function (p) { return p.at > since30; });
  var stamps = T_('stamps').all().filter(function (s) { return s.at > since30; });

  // 今月のポイント
  var pts = {};
  function add(id, k) { if (!id) return; pts[id] = pts[id] || { clean: 0, pickup: 0, review: 0, stamp: 0 }; pts[id][k]++; }
  T_('cleanlogs').all().forEach(function (l) {
    if (dayKey_(l.at).slice(0, 7) === monthKey) add(l.by, 'clean');
    if (l.review && dayKey_(l.review.at).slice(0, 7) === monthKey) add(l.review.by, 'review');
  });
  T_('pickups').all().forEach(function (p) { if (dayKey_(p.at).slice(0, 7) === monthKey) add(p.by, 'pickup'); });
  T_('stamps').all().forEach(function (s) { if (dayKey_(s.at).slice(0, 7) === monthKey) add(s.to, 'stamp'); });

  var subs = T_('subs').all().filter(function (s) { return s.staffId === me.id; }).length;

  return {
    ok: true, now: now, today: today, todayDow: dow_(now),
    me: { id: me.id, name: me.name, boss: !!me.boss, subs: subs },
    staff: publicStaff_(),
    tasks: tasks, zones: T_('zones').all().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }),
    cleanlogs: cleanlogs, notices: notices, pickups: pickups, stamps: stamps, points: pts,
    stampNames: STAMPS, noticeTypes: NOTICE_TYPES
  };
}

/* ───────── やること ───────── */

function addTask_(me, r) {
  var title = clip_(r.title, 60);
  var to = validIds_(r.assignees);
  var due = Number(r.due);
  if (!title) return { ok: false, error: '「何を」を入れてください' };
  if (!to.length) return { ok: false, error: '担当を選んでください' };
  if (!due || due < Date.now() - DAY) return { ok: false, error: '期限を正しく入れてください' };
  var rp = r.repeat || {};
  var repeat = { type: ['none', 'daily', 'weekly', 'monthly'].indexOf(rp.type) >= 0 ? rp.type : 'none', days: [] };
  if (repeat.type === 'weekly') {
    repeat.days = (rp.days || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    if (!repeat.days.length) repeat.days = [dow_(due)];
  }
  var remind = [0, 15, 30, 60, 180].indexOf(Number(r.remind)) >= 0 ? Number(r.remind) : 0;
  var t = {
    id: uid_(), title: title, note: clip_(r.note, 200), assignees: to, due: due, remind: remind, repeat: repeat,
    by: me.id, at: Date.now(), done: false, doneBy: '', doneAt: 0, remSent: false, dueSent: false, lateSent: false, lastNudge: 0
  };
  T_('tasks').put(t);
  var others = to.filter(function (id) { return id !== me.id; });
  if (others.length) enqueue_(others, '📝 ' + san_(me.name) + 'から「やること」', title + '（' + md_(due) + ' ' + hm_(due) + 'まで）', 'task');
  return state_(me);
}

function nextDue_(t) {
  var due = t.due, now = Date.now(), guard = 0;
  function step(ms) {
    var d = new Date(ms + JST);
    if (t.repeat.type === 'daily') return ms + DAY;
    if (t.repeat.type === 'weekly') {
      for (var i = 1; i <= 7; i++) { if (t.repeat.days.indexOf(dow_(ms + i * DAY)) >= 0) return ms + i * DAY; }
      return ms + 7 * DAY;
    }
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(day, dim), d.getUTCHours(), d.getUTCMinutes()) - JST;
  }
  do { due = step(due); guard++; } while (due <= now && guard < 400);
  return due;
}

function doneTask_(me, r) {
  var t = T_('tasks').get(String(r.id));
  if (!t) return { ok: false, error: 'このやることは見つかりません' };
  if (t.done) return state_(me);
  t.done = true; t.doneBy = me.id; t.doneAt = Date.now();
  T_('tasks').put(t);
  if (t.repeat && t.repeat.type !== 'none') {
    var n = JSON.parse(JSON.stringify(t));
    n.id = uid_(); n.due = nextDue_(t); n.at = Date.now();
    n.done = false; n.doneBy = ''; n.doneAt = 0; n.remSent = false; n.dueSent = false; n.lateSent = false; n.lastNudge = 0;
    T_('tasks').put(n);
  }
  if (t.by !== me.id) enqueue_([t.by], '✅ ' + san_(me.name) + 'が完了', t.title, 'task');
  return state_(me);
}

function delTask_(me, r) {
  var t = T_('tasks').get(String(r.id));
  if (!t) return state_(me);
  if (t.by !== me.id && !me.boss) return { ok: false, error: '消せるのは登録した人か社長だけです' };
  T_('tasks').del(t.id);
  return state_(me);
}

function nudge_(me, r) {
  var t = T_('tasks').get(String(r.id));
  if (!t || t.done) return { ok: false, error: 'このやることは終わっています' };
  if (Date.now() - (t.lastNudge || 0) < 10 * MIN) return { ok: false, error: '催促は10分に1回までです' };
  t.lastNudge = Date.now();
  T_('tasks').put(t);
  enqueue_(t.assignees.filter(function (id) { return id !== me.id; }), '📣 ' + san_(me.name) + 'から催促', t.title + ' をお願いします', 'task');
  return state_(me);
}

/* ───────── 掃除 ───────── */

function cleanDone_(me, r) {
  var z = T_('zones').get(String(r.zoneId));
  if (!z) return { ok: false, error: 'この場所は見つかりません' };
  if (!r.photo) return { ok: false, error: '完了の写真を撮ってください' };
  var today = dayKey_(Date.now());
  var exist = T_('cleanlogs').all().filter(function (l) { return l.zoneId === z.id && l.day === today; })[0];
  if (exist) return { ok: false, error: '今日はもう完了しています' };
  var photo = savePhoto_(r.photo, 'clean_' + z.name);
  T_('cleanlogs').put({ id: uid_(), zoneId: z.id, zoneName: z.name, day: today, by: me.id, at: Date.now(), photo: photo, review: null });
  return state_(me);
}

function review_(me, r) {
  var l = T_('cleanlogs').get(String(r.logId));
  if (!l) return { ok: false, error: '記録が見つかりません' };
  if (l.by === me.id) return { ok: false, error: '自分の掃除はチェックできません' };
  if (l.review) return { ok: false, error: 'もうチェック済みです' };
  var ok = !!r.ok;
  var comment = clip_(r.comment, 100);
  if (!ok && !comment) return { ok: false, error: 'NGの理由をひとこと入れてください' };
  l.review = { by: me.id, ok: ok, comment: comment, at: Date.now() };
  T_('cleanlogs').put(l);
  if (ok) enqueue_([l.by], '👌 ' + l.zoneName + ' OK', san_(me.name) + 'がチェックしました', 'clean');
  else enqueue_([l.by], '⚠️ ' + l.zoneName + ' やり直し', san_(me.name) + '：' + comment, 'clean');
  return state_(me);
}

/* ───────── 連絡（欠勤など） ───────── */

function addNotice_(me, r) {
  var type = NOTICE_TYPES.indexOf(r.type) >= 0 ? r.type : 'その他';
  var day = /^\d{4}-\d{2}-\d{2}$/.test(r.day || '') ? r.day : dayKey_(Date.now());
  var msg = clip_(r.message, 200);
  var to = r.to === 'boss' ? 'boss' : 'all';
  var notifyAt = Number(r.notifyAt) || Date.now();
  if (!msg && type === 'その他') return { ok: false, error: '内容を入れてください' };
  T_('notices').put({ id: uid_(), type: type, day: day, message: msg, from: me.id, to: to, notifyAt: notifyAt, sent: false, at: Date.now() });
  return state_(me);
}

/* ───────── 拾った・スタンプ ───────── */

function pickup_(me, r) {
  if (!r.photo) return { ok: false, error: '拾ったものの写真を撮ってください' };
  var recent = T_('pickups').all().filter(function (p) { return p.by === me.id && Date.now() - p.at < 3 * MIN; });
  if (recent.length) return { ok: false, error: '続けての記録は3分あけてください' };
  var photo = savePhoto_(r.photo, 'pickup');
  T_('pickups').put({ id: uid_(), by: me.id, at: Date.now(), photo: photo, note: clip_(r.note, 60) });
  return state_(me);
}

function stamp_(me, r) {
  if (!STAMPS[r.stamp]) return { ok: false, error: 'スタンプが選べていません' };
  var to = activeStaff_(r.to);
  if (!to) return { ok: false, error: '相手が見つかりません' };
  if (to.id === me.id) return { ok: false, error: '自分には送れません' };
  var tt = ['task', 'clean', 'pickup', 'notice', 'person'].indexOf(r.targetType) >= 0 ? r.targetType : 'person';
  var dup = T_('stamps').all().filter(function (s) {
    return s.from === me.id && s.targetType === tt && s.targetId === String(r.targetId || '') && s.stamp === r.stamp && s.to === to.id;
  });
  if (dup.length) return state_(me);
  T_('stamps').put({ id: uid_(), targetType: tt, targetId: String(r.targetId || ''), from: me.id, to: to.id, stamp: r.stamp, at: Date.now() });
  enqueue_([to.id], '💌 ' + san_(me.name) + 'からスタンプ', '「' + STAMPS[r.stamp] + '」', 'point');
  return state_(me);
}

/* ───────── 通知の登録 ───────── */

function subscribe_(me, r) {
  var sub = r.sub;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { ok: false, error: '通知の登録に失敗しました' };
  if (!/^https:\/\//.test(sub.endpoint)) return { ok: false, error: '通知の登録に失敗しました' };
  var id = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sub.endpoint)).slice(0, 22);
  T_('subs').put({ id: id, staffId: me.id, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now() });
  return state_(me);
}

/* ───────── 管理（社長） ───────── */

function admin_(r) {
  if (String(r.pin || '') !== prop_('ADMIN_PIN')) return { ok: false, error: '暗証番号が違います', badPin: true };
  var me = activeStaff_(r.me);
  var op = r.op;
  var st = T_('staff'), zs = T_('zones');

  if (op === 'addStaff') {
    var name = clip_(r.name, 20);
    if (!name) return { ok: false, error: '名前を入れてください' };
    st.put({ id: uid_(), name: name, boss: !!r.boss, active: true, at: Date.now() });
  } else if (op === 'setStaff') {
    var s = st.get(String(r.id));
    if (!s) return { ok: false, error: '見つかりません' };
    var next = { name: r.name != null ? (clip_(r.name, 20) || s.name) : s.name,
      active: r.active != null ? !!r.active : s.active, boss: r.boss != null ? !!r.boss : s.boss };
    var otherBoss = st.all().some(function (x) { return x.id !== s.id && x.active && x.boss; });
    if (s.boss && s.active && !(next.boss && next.active) && !otherBoss) {
      return { ok: false, error: '社長（管理者）が1人もいなくなるので変更できません' };
    }
    s.name = next.name; s.active = next.active; s.boss = next.boss;
    st.put(s);
  } else if (op === 'addZone' || op === 'setZone') {
    var z = op === 'addZone' ? { id: uid_(), order: zs.all().length } : zs.get(String(r.id));
    if (!z) return { ok: false, error: '見つかりません' };
    z.name = clip_(r.name, 20) || z.name;
    if (!z.name) return { ok: false, error: '場所の名前を入れてください' };
    z.owner = activeStaff_(r.owner) ? String(r.owner) : (z.owner || '');
    z.days = (Array.isArray(r.days) && r.days.length ? r.days : (z.days || [0, 1, 2, 3, 4, 5, 6]))
      .map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    z.deadline = /^\d{2}:\d{2}$/.test(r.deadline || '') ? r.deadline : (z.deadline || '10:00');
    zs.put(z);
  } else if (op === 'delZone') {
    zs.del(String(r.id));
  } else if (op === 'rotate') {
    var zones = zs.all().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var owners = zones.map(function (z) { return z.owner; });
    if (zones.length > 1) {
      zones.forEach(function (z, i) { z.owner = owners[(i - 1 + owners.length) % owners.length]; zs.put(z); });
      enqueue_(zones.map(function (z) { return z.owner; }), '🧹 掃除の担当が変わりました', 'アプリで自分の担当場所を確認してください', 'clean');
    }
  } else if (op === 'setCode') {
    var c = String(r.newCode || '').trim();
    if (c.length < 4) return { ok: false, error: 'チームコードは4文字以上にしてください' };
    setProp_('TEAM_CODE', c);
    return { ok: true, codeChanged: true };
  } else if (op === 'setPin') {
    if (!/^\d{4,8}$/.test(String(r.newPin || ''))) return { ok: false, error: '暗証番号は4〜8桁の数字にしてください' };
    setProp_('ADMIN_PIN', String(r.newPin));
  } else if (op !== 'check') {
    return { ok: false, error: '不明な操作です' };
  }
  var res = me ? state_(me) : { ok: true };
  res.allStaff = st.all().map(function (s) { return { id: s.id, name: s.name, boss: !!s.boss, active: !!s.active }; });
  res.adminOk = true;
  return res;
}

/* ───────── 定期チェック（送信係が来るたびに実行） ───────── */

function tick_() {
  var now = Date.now();
  var today = dayKey_(now);

  T_('tasks').all().forEach(function (t) {
    if (t.done) return;
    var changed = false;
    if (t.remind > 0 && !t.remSent && !t.dueSent && now >= t.due - t.remind * MIN && now < t.due) {
      enqueue_(t.assignees, '⏰ まもなく期限', t.title + '（' + hm_(t.due) + 'まで）', 'task');
      t.remSent = true; changed = true;
    }
    if (!t.dueSent && now >= t.due) {
      if (now - t.due < 6 * 3600 * 1000) enqueue_(t.assignees, '⏰ 期限です', t.title, 'task');
      t.dueSent = true; t.remSent = true; changed = true;
    }
    if (!t.lateSent && now >= t.due + 60 * MIN) {
      if (now - t.due < 12 * 3600 * 1000) {
        var names = t.assignees.map(nameOf_).join('・');
        enqueue_(t.assignees.concat([t.by]), '⚠️ 期限切れ', t.title + '（担当：' + names + '）', 'task');
      }
      t.lateSent = true; changed = true;
    }
    if (changed) T_('tasks').put(t);
  });

  var todayDow = dow_(now);
  var doneToday = {};
  T_('cleanlogs').all().forEach(function (l) { if (l.day === today) doneToday[l.zoneId] = true; });
  T_('zones').all().forEach(function (z) {
    if (!z.owner || (z.days || []).indexOf(todayDow) < 0 || doneToday[z.id]) return;
    if (z.lastNotified === today) return;
    var dl = at_(today, z.deadline);
    if (now >= dl) {
      enqueue_([z.owner], '🧹 掃除がまだです', z.name + '（' + z.deadline + 'まで）', 'clean');
      z.lastNotified = today;
      T_('zones').put(z);
    }
  });

  T_('notices').all().forEach(function (n) {
    if (n.sent || now < n.notifyAt) return;
    var who = nameOf_(n.from);
    var to = n.to === 'boss' ? bossIds_() : publicStaff_().map(function (s) { return s.id; });
    to = to.filter(function (id) { return id !== n.from; });
    enqueue_(to, '📢 ' + n.type + '：' + san_(who), md_(at_(n.day, '12:00')) + (n.message ? ' ' + n.message : ''), 'notice');
    n.sent = true;
    T_('notices').put(n);
  });

  if (prop_('LAST_PRUNE') !== today) { prune_(now); setProp_('LAST_PRUNE', today); }
}

function prune_(now) {
  var old = now - 62 * DAY;
  T_('tasks').all().forEach(function (t) { if (t.done && t.doneAt < old) T_('tasks').del(t.id); });
  ['cleanlogs', 'pickups', 'stamps'].forEach(function (n) {
    T_(n).all().forEach(function (x) { if (x.at < old) T_(n).del(x.id); });
  });
  T_('notices').all().forEach(function (x) { if (x.sent && x.notifyAt < old) T_('notices').del(x.id); });
  T_('outbox').all().forEach(function (x) { if (x.sentAt && x.sentAt < now - 3 * DAY) T_('outbox').del(x.id); });
}

function outbox_() {
  tick_();
  var subsBy = {};
  T_('subs').all().forEach(function (s) { (subsBy[s.staffId] = subsBy[s.staffId] || []).push({ sid: s.id, sub: s.sub }); });
  var items = [];
  T_('outbox').all().forEach(function (o) {
    if (o.sentAt) return;
    var subs = subsBy[o.to] || [];
    if (!subs.length || Date.now() - o.at > DAY) { o.sentAt = Date.now(); o.skipped = true; T_('outbox').put(o); return; }
    if (items.length < 300) items.push({ oid: o.id, payload: { title: o.title, body: o.body, tab: o.tab, tag: o.id }, subs: subs });
  });
  return { ok: true, items: items };
}

function ack_(r) {
  (r.sent || []).forEach(function (id) {
    var o = T_('outbox').get(String(id));
    if (o) { o.sentAt = Date.now(); T_('outbox').put(o); }
  });
  (r.gone || []).forEach(function (sid) { T_('subs').del(String(sid)); });
  return { ok: true };
}
