const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store, key, uniqueTags, matchesTags } = require('../docs/assets/research-store.js');
const config = { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public-test-key' };
const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
test('post keys survive archive IDs changing; phrase tags stay intact and deduplicate', () => {
  assert.equal(key({ shortcode: 'DXWcvRSDmDO', id: 'old-id' }), key({ shortcode: 'DXWcvRSDmDO', id: 'new-id' }));
  assert.deepEqual(uniqueTags([' educational ', 'Educational', 'Spiritual  but not Religious', 'הערות מחקר', '']), ['educational', 'Spiritual but not Religious', 'הערות מחקר']);
  assert.equal(matchesTags(['Educational', 'promotional'], ['educational', 'promotional']), true);
  assert.equal(matchesTags(['educational'], ['educational', 'promotional']), false);
  assert.equal(matchesTags(['educational'], ['educational', 'promotional'], 'any'), true);
});
test('save sends the loaded version and keeps the previous cache after a conflict', async () => {
  let sent;
  const store = new Store(config, async (url, options) => { sent = JSON.parse(options.body); return response({ code: '40001', message: 'conflict' }, 409); }, storage());
  store.session = { access_token: 'token', expires_at: Date.now() / 1000 + 3600 };
  store.rows.set('post', { post_key: 'post', notes: 'old', tags: [], version: 3 });
  await assert.rejects(store.save({ shortcode: 'post' }, 'my draft', ['educational'], 3), error => error.code === '40001');
  assert.equal(sent.p_expected_version, 3);
  assert.equal(store.get({ shortcode: 'post' }).notes, 'old');
});
test('load paginates past 500 annotations', async () => {
  const urls = [];
  const store = new Store(config, async url => { urls.push(url); return response(url.includes('offset=0') ? Array.from({ length: 500 }, (_, i) => ({ post_key: String(i) })) : [{ post_key: 'last' }]); }, storage());
  store.session = { access_token: 'token', expires_at: Date.now() / 1000 + 3600 };
  await store.load();
  assert.equal(store.rows.size, 501);
  assert.match(urls[1], /offset=500/);
});
test('expired sessions refresh once across concurrent requests', async () => {
  let refreshes = 0;
  const store = new Store(config, async (url, options) => {
    if (url.includes('refresh_token')) { refreshes++; return response({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }); }
    assert.equal(options.headers.Authorization, 'Bearer new-token'); return response([]);
  }, storage());
  store.session = { access_token: 'old', refresh_token: 'refresh', expires_at: 1 };
  await Promise.all([store.request('/rest/v1/research_annotations'), store.request('/rest/v1/research_annotations')]);
  assert.equal(refreshes, 1);
});
test('logout invalidates an in-flight load so private data cannot return', async () => {
  let finish;
  const store = new Store(config, () => new Promise(resolve => { finish = resolve; }), storage());
  store.session = { access_token: 'token', expires_at: Date.now() / 1000 + 3600 };
  const pending = store.load();
  store.clear(); finish(response([{ post_key: 'private' }]));
  await assert.rejects(pending, /Session changed/);
  assert.equal(store.rows.size, 0);
});
test('authenticated accounts without membership cannot open the workspace', async () => {
  const store = new Store(config, async url => response(url.includes('/token?') ? { access_token: 'token', expires_in: 3600, user: { id: 'stranger' } } : []), storage());
  await assert.rejects(store.login('stranger@example.test', 'password'), /not been granted/);
  assert.equal(store.session, null);
});
