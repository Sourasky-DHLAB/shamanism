const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../docs/assets/password-recovery.js');
test('only recovery links are accepted; expired links get a clear message', () => {
  assert.equal(P.readLink('#type=recovery&access_token=test-token'), 'test-token');
  assert.throws(() => P.readLink('#access_token=test-token&type=signup'), /reset link/);
  assert.throws(() => P.readLink('#error=access_denied&error_description=Expired'), /expired/);
  assert.throws(() => P.readLink(''), /reset link/);
});
test('validate minimum length and confirmation', () => {
  assert.throws(() => P.validatePassword('short', 'short'), /8 characters/);
  assert.throws(() => P.validatePassword('long-password', 'different'), /do not match/);
  P.validatePassword('long-password', 'long-password');
});
test('recovery request sends email and encoded redirect without admin credentials', async () => {
  let request;
  const c = new P.Client({ supabaseUrl: 'https://test.supabase.co', publishableKey: 'public-key' }, async (url, options) => {
    request = { url, ...options }; return { ok:true, json:async()=>({}) };
  });
  await c.send(' researcher@example.test ', 'https://example.test/archive/reset-password.html');
  assert.equal(JSON.parse(request.body).email, 'researcher@example.test');
  assert.equal(request.headers.Authorization, undefined);
  assert.match(request.url, /redirect_to=https%3A%2F%2Fexample.test%2Farchive%2Freset-password.html/);
  await c.update('new-test-password', 'recovery-token');
  assert.equal(request.method, 'PUT');
  assert.equal(request.headers.Authorization, 'Bearer recovery-token');
});
