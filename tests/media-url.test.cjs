const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../docs/assets/media-url.js');
test('archived local paths resolve to the original CloudFront account-root keys', () => {
  assert.equal(M.url('media/the.baby.mudang/example-00.jpg'), 'https://d3ond2bpn3cm3y.cloudfront.net/the.baby.mudang/example-00.jpg');
  assert.equal(M.url('media/shaman.mudang/example-00.mp4'), 'https://d3ond2bpn3cm3y.cloudfront.net/shaman.mudang/example-00.mp4');
  assert.equal(M.url('https://d3ond2bpn3cm3y.cloudfront.net/already.jpg'), 'https://d3ond2bpn3cm3y.cloudfront.net/already.jpg');
  assert.equal(M.url('https://example.test/source.jpg'), 'https://example.test/source.jpg');
  assert.equal(M.url(null), '');
});
