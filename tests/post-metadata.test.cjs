const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../docs/assets/post-metadata.js');
const recovery = { account: M.ACCOUNT, retrievedAt: '2026-11-09T08:48:06Z', posts: [{ shortcode: 'A', ownerUsername: 'publisher', collaborators: [{ username: 'collaborator' }], taggedUsers: null, mentions: ['mentioned'], hashtags: ['live'] }] };
test('merge metadata only into the target collection, preserving posts and comments', () => {
  const other = { id: 'A', shortcode: 'A', caption: '#other', comments: [{ text: 'keep' }] };
  const post = { shortcode: 'A', caption: '@archived #ישן #live', comments: [{ text: 'original' }] };
  const before = JSON.stringify(post);
  const archive = { collections: [{ username: M.ACCOUNT, posts: [post] }, { username: 'other', posts: [other] }] };
  M.enrich(archive, recovery);
  assert.equal(other.instagramMetadata, undefined);
  const { instagramMetadata, ...original } = post;
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(instagramMetadata.hashtags, ['ישן', 'live']);
  assert.deepEqual(instagramMetadata.mentions, ['archived', 'mentioned']);
  assert.equal(instagramMetadata.taggedUsers, null);
  assert.match(M.searchText(post), /@collaborator/);
  assert.match(M.searchText(post), /#ישן/);
});
test('missing matches recover caption fields and keep unknown tags distinguishable', () => {
  const p = { shortcode: 'missing', caption: 'name@example.com @someone. #한국 #שלום' };
  M.enrich({ collections: [{ username: M.ACCOUNT, posts: [p] }] }, recovery);
  assert.equal(p.instagramMetadata.recoveryStatus, 'caption-only');
  assert.deepEqual(p.instagramMetadata.mentions, ['someone']);
  assert.match(M.render(p), /Not recovered/);
  assert.match(M.render(p), /%ED%95%9C%EA%B5%AD/);
  assert.deepEqual(M.accounts([{ username: 'javascript:alert(1)' }]), []);
});
