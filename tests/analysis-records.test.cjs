const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../docs/assets/analysis-records.js');
const post = { id: 'p1', username: 'publisher', caption: 'caption boundary', altText: 'image description', media: [{ altText: 'image description' }], comments: [
  { id: '1', username: 'a', text: 'beautiful' },
  { id: '2', username: 'b', text: 'beautiful' },
  { id: '3', username: 'c', text: 'beautiful' },
  { id: '4', username: 'd', text: 'oh wow you have been here' }
] };
test('reported four-comment example produces three isolated KWIC hits', () => {
  const docs = A.buildDocuments([post], 'comments');
  assert.equal(docs.length, 4);
  const hits = A.kwic(docs, 'beautiful', 6, false);
  assert.equal(hits.length, 3);
  assert.ok(hits.every(hit => hit.left === '' && hit.right === ''));
  assert.deepEqual(hits.map(hit => hit.doc.recordId), ['1', '2', '3']);
  assert.deepEqual(hits.map(hit => hit.doc.recordAuthor), ['a', 'b', 'c']);
});
test('n-grams and collocations do not cross comment, source, or post boundaries', () => {
  const docs = A.buildDocuments([post, { id: 'p2', caption: 'other post', comments: [] }], 'both');
  const streams = docs.map(d => A.tokenize(d.text));
  const grams = A.ngrams(streams, 2);
  assert.equal(grams.has('beautiful beautiful'), false);
  assert.equal(grams.has('beautiful oh'), false);
  assert.equal(grams.has('boundary beautiful'), false);
  assert.equal(grams.has('description other'), false);
  assert.equal(grams.get('oh wow'), 1);
  const pairs = A.collocations(streams, 4).pairMap;
  assert.equal(pairs.has('beautiful|||oh'), false);
  assert.equal(pairs.get('oh|||wow'), 1);
  assert.equal(docs.filter(d => d.sourceType === 'Alt text').length, 1);
});
test('replies are separate records; repeated storage of the same reply is deduplicated', () => {
  const reply = { id: 'r', parentCommentId: 'c', username: 'replyauthor', text: 'reply words' };
  const docs = A.buildDocuments([{ id: 'p', comments: [{ id: 'c', text: 'parent words', replies: [reply] }, reply, { id: 'blank', text: ' ' }] }], 'comments');
  assert.equal(docs.length, 2);
  assert.equal(docs[1].sourceType, 'Reply');
  assert.equal(A.kwic(docs, 'words reply', 4, false).length, 0);
  assert.equal(A.kwic(docs, 'reply words', 4, false).length, 1);
});
