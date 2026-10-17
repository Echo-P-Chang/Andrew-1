const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.cjs');
const fs = require('node:fs/promises');
let server;
let origin;
before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
test('部署入口提供首頁、樣式與健康檢查', async () => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /注音打擊王/);
  const css = await fetch(`${origin}/layout.css`);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const health = await fetch(`${origin}/healthz`).then(response => response.json());
  assert.equal(health.status, 'ok');
  assert.equal(health.app, 'andrew1');
});
test('伺服器只公開指定的遊戲素材，不公開 repo 或部署設定', async () => {
  for (const file of ['.env', '.git/config', 'README.md', 'server.cjs', 'hosting/release.json', 'hosting/public-files.json', 'scripts/deploy-azure.sh', 'tests/server.test.cjs']) {
    assert.equal((await fetch(`${origin}/${file}`)).status, 404, file);
  }
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
});
test('音效提供正確 MIME、HEAD 與可重播的 byte range', async () => {
  const file = await fs.readFile(`${__dirname}/../assets/cheer.wav`);
  const head = await fetch(`${origin}/assets/cheer.wav`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'audio/wav');
  assert.equal(Number(head.headers.get('content-length')), file.length);
  const partial = await fetch(`${origin}/assets/cheer.wav`, { headers: { Range: 'bytes=0-31' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 0-31/${file.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), file.subarray(0, 32));
  const invalid = await fetch(`${origin}/assets/cheer.wav`, { headers: { Range: 'bytes=9999999-' } });
  assert.equal(invalid.status, 416);
});
