(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalysisRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function tokenize(text, normalize = true) {
    const source = String(text || '');
    const value = normalize ? source.normalize('NFKD').toLowerCase() : source;
    return (value.match(/\p{L}[\p{L}\p{N}'’_-]*/gu) || []).map(t => t.replace(/’/g, "'"));
  }
  function buildDocuments(posts, mode) {
    const records = [];
    for (const post of posts) {
      const add = (sourceType, recordId, text, recordAuthor, sourceDate, extra = {}) => {
        if (String(text || '').trim()) records.push({ ...post, sourceType, recordId, text: String(text), recordAuthor, sourceDate, ...extra });
      };
      if (mode === 'both' || mode === 'captions') add('Caption', `${post.id}:caption`, post.caption, post.username, post.datePosted);
      if (mode === 'both' || mode === 'comments') {
        const seen = new Set();
        function visit(comments, path = 'comments') {
          (comments || []).forEach((comment, index) => {
            const id = comment.id == null || comment.id === '' ? `${path}:${index}` : String(comment.id);
            if (seen.has(id)) return;
            seen.add(id);
            add(comment.parentCommentId || path !== 'comments' ? 'Reply' : 'Comment', id, comment.text, comment.username, comment.date, { parentCommentId: comment.parentCommentId || null });
            visit(comment.replies, `${path}:${index}:replies`);
          });
        }
        visit(post.comments);
      }
      if (mode === 'both' || mode === 'alt') {
        const media = (post.media || []).map((item, i) => ({ item, i })).filter(({ item }) => String(item.altText || '').trim());
        // The post-level description is often a copy of its first media description.
        if (!media.some(({ item }) => item.altText === post.altText)) add('Alt text', `${post.id}:alt`, post.altText, post.username, post.datePosted);
        for (const { item, i } of media) add('Alt text', `${post.id}:media:${item.id || i}:alt`, item.altText, post.username, post.datePosted);
      }
    }
    return records;
  }
  function ngrams(streams, n, exclude = () => false) {
    const counts = new Map();
    for (const tokens of streams) for (let i = 0; i <= tokens.length - n; i++) {
      const span = tokens.slice(i, i + n);
      if (span.some(exclude)) continue;
      const gram = span.join(' ');
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
  }
  function collocations(streams, windowSize, exclude = () => false) {
    const pairMap = new Map(), freq = new Map();
    let totalTokens = 0;
    for (const tokens of streams) {
      const eligible = tokens.filter(token => !exclude(token));
      totalTokens += eligible.length;
      eligible.forEach(token => freq.set(token, (freq.get(token) || 0) + 1));
      for (let i = 0; i < tokens.length; i++) for (let j = i + 1; j < Math.min(tokens.length, i + windowSize + 1); j++) {
        const a = tokens[i], b = tokens[j];
        if (!a || !b || a === b || exclude(a) || exclude(b)) continue;
        const key = a < b ? `${a}|||${b}` : `${b}|||${a}`;
        pairMap.set(key, (pairMap.get(key) || 0) + 1);
      }
    }
    return { pairMap, freq, totalTokens };
  }
  function kwic(docs, term, contextSize, caseSensitive, limit = 100) {
    const needle = tokenize(term, !caseSensitive);
    if (!needle.length) return [];
    const lines = [];
    for (const doc of docs) {
      const tokens = tokenize(doc.text, !caseSensitive);
      for (let i = 0; i <= tokens.length - needle.length; i++) {
        if (!needle.every((token, k) => token === tokens[i + k])) continue;
        lines.push({ left: tokens.slice(Math.max(0, i - contextSize), i).join(' '), hit: tokens.slice(i, i + needle.length).join(' '), right: tokens.slice(i + needle.length, i + needle.length + contextSize).join(' '), doc });
        if (lines.length >= limit) return lines;
      }
    }
    return lines;
  }
  function frequencies(streams) {
    const counts = new Map();
    for (const tokens of streams) {
      const seen = new Set();
      for (const term of tokens) {
        const row = counts.get(term) || { term, count: 0, records: 0 };
        row.count++;
        if (!seen.has(term)) { row.records++; seen.add(term); }
        counts.set(term, row);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  }
  function parseStopwords(text) {
    const words = String(text).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
    if (words.some(word => /\s/u.test(word))) throw new Error('Use one stopword per line, without spaces inside a word.');
    return new Set(words.map(word => word.normalize('NFKD').toLowerCase().replace(/’/g, "'")));
  }
  return { tokenize, buildDocuments, ngrams, collocations, kwic, frequencies, parseStopwords };
});
