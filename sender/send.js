/**
 * 通知の送信係：Google側から「送る予定の通知」を受け取り、各スマホへ届ける。
 * GitHub Actions が5分ごとに実行する。必要な値は GitHub の Secrets に入れる。
 */
const webpush = require('web-push');

const { GAS_URL, SENDER_TOKEN, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT } = process.env;

async function call(body) {
  const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('Google側の応答が読めません: ' + text.slice(0, 200)); }
}

async function main() {
  if (!GAS_URL || !SENDER_TOKEN || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.log('設定がまだ揃っていないので何もしません');
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'https://github.com', VAPID_PUBLIC, VAPID_PRIVATE);

  const box = await call({ a: 'outbox', token: SENDER_TOKEN });
  if (!box.ok) throw new Error(box.error || 'outbox に失敗');
  const items = box.items || [];
  if (!items.length) { console.log('送る通知はありません'); return; }

  const sent = [], gone = new Set();
  let okCount = 0, ngCount = 0;
  for (const it of items) {
    const payload = JSON.stringify(it.payload);
    await Promise.all(it.subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.sub, payload, { TTL: 6 * 3600, urgency: 'high' });
        okCount++;
      } catch (err) {
        ngCount++;
        if (err.statusCode === 404 || err.statusCode === 410) gone.add(s.sid);
        console.log('送信失敗', err.statusCode || '', String(err.body || err.message).slice(0, 120));
      }
    }));
    sent.push(it.oid);
  }
  const ack = await call({ a: 'ack', token: SENDER_TOKEN, sent, gone: [...gone] });
  console.log(`通知 ${items.length}件 / 端末へ成功 ${okCount} 失敗 ${ngCount} / 無効な端末 ${gone.size} / ack ${ack.ok}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
