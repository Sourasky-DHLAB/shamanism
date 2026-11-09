(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PostMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const ACCOUNT = 'the.baby.mudang';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function unique(values) {
    const seen = new Set();
    return values.filter(value => {
      const k = value.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  function accounts(values) {
    if (!Array.isArray(values)) return null;
    return unique(values.map(v => typeof v === 'string' ? v : v?.username).filter(Boolean)
      .map(v => v.replace(/^@/, '')).filter(v => /^[A-Za-z0-9_][A-Za-z0-9._]{0,29}$/.test(v)));
  }
  function captionFields(caption = '') {
    return {
      mentions: unique([...caption.matchAll(/(?:^|[^A-Za-z0-9._])@([A-Za-z0-9_][A-Za-z0-9._]{0,29})/g)].map(m => m[1].replace(/\.+$/, ''))),
      hashtags: unique([...caption.matchAll(/(?:^|[^\p{L}\p{M}\p{N}_])#([\p{L}\p{M}\p{N}_]+)/gu)].map(m => m[1]))
    };
  }
  function enrich(archive, recovery) {
    if (recovery && recovery.account !== ACCOUNT) throw new Error('Unexpected metadata account.');
    const index = new Map((recovery?.posts || []).map(p => [p.shortcode, p]));
    for (const collection of archive.collections || []) for (const post of collection.posts || []) {
      if (String(collection.username || post.username || '').replace(/^@/, '').toLowerCase() !== ACCOUNT) continue;
      const r = index.get(post.shortcode || post.id);
      const parsed = captionFields(post.caption || '');
      post.instagramMetadata = {
        ownerUsername: r?.ownerUsername || null,
        collaborators: accounts(r?.collaborators),
        taggedUsers: accounts(r?.taggedUsers),
        mentions: unique([...parsed.mentions, ...(accounts(r?.mentions) || [])]),
        hashtags: unique([...parsed.hashtags, ...(r?.hashtags || []).filter(v => typeof v === 'string').map(v => v.replace(/^#/, ''))]),
        retrievedAt: r ? recovery.retrievedAt : null,
        recoveryStatus: r ? 'recovered' : 'caption-only'
      };
    }
    return archive;
  }
  let loading;
  async function load() {
    if (!loading) loading = fetch('data/the-baby-mudang-metadata.json', { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      .then(r => { if (!r.ok) throw new Error('Account metadata could not be loaded.'); return r.json(); });
    return loading;
  }
  async function attach(archive) {
    try { return enrich(archive, await load()); }
    catch (_) { return enrich(archive, null); }
  }
  function searchText(post) {
    const m = post.instagramMetadata;
    return m ? [m.ownerUsername || '', ...(m.collaborators || []), ...(m.taggedUsers || []), ...m.mentions].map(v => `${v} @${v}`).concat(m.hashtags.flatMap(v => [v, `#${v}`])).join(' ') : '';
  }
  function render(post) {
    const m = post.instagramMetadata;
    if (!m) return '';
    const links = values => values === null ? 'Not recovered' : values.length ? values.map(v => `<a href="https://www.instagram.com/${encodeURIComponent(v)}/" target="_blank" rel="noopener">@${escape(v)}</a>`).join(', ') : 'None returned';
    return `<div><strong>Tagged users and mentions</strong>
      <p>Original publisher: ${links(m.ownerUsername ? [m.ownerUsername] : null)}</p>
      <p>Collaborators: ${links(m.collaborators)}</p>
      <p>Tagged accounts: ${links(m.taggedUsers)}</p>
      <p>Caption mentions: ${links(m.mentions)}</p>
      <small>${m.retrievedAt ? `Metadata retrieved ${escape(new Date(m.retrievedAt).toLocaleString())}. Caption mentions include the archived caption.` : 'Only the archived caption was inspected; account tags and collaborators have not been recovered.'}</small>
      </div><div><strong>Instagram hashtags</strong><p>${m.hashtags.length ? m.hashtags.map(v => `<a href="https://www.instagram.com/explore/tags/${encodeURIComponent(v)}/" target="_blank" rel="noopener">#${escape(v)}</a>`).join(' ') : 'None found in the available caption or metadata.'}</p></div>`;
  }
  return { ACCOUNT, accounts, captionFields, enrich, attach, searchText, render };
});
