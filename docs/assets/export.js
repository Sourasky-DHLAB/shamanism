(() => {
  const els = {};


  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    els.exportBtn = document.querySelector('#export-csv');
    els.exportFormat = document.querySelector('#export-format');
    if (!els.exportBtn || !els.exportFormat) return;
    els.exportBtn.addEventListener('click', exportCurrentCollection);
  }

  async function exportCurrentCollection() {
    const archive = await loadArchive();
    const posts = flattenArchive(archive).filter(matchesCurrentFilters);
    const mode = els.exportFormat.value;
    const csv = mode === 'post' ? buildPostCsv(posts) : buildCommentCsv(posts);
    const filename = makeFilename(archive, posts, mode);
    downloadText(csv, filename, 'text/csv;charset=utf-8;');
  }

  async function loadArchive() {
    const response = await fetch('data/archive.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load archive (${response.status})`);
    return response.json();
  }

  function flattenArchive(archive) {
    return (archive.collections || []).flatMap(collection =>
      (collection.posts || []).map(post => ({
        ...post,
        collectionId: collection.id,
        collectionTitle: collection.title
      }))
    );
  }

  function matchesCurrentFilters(post) {
    const query = normalize(document.querySelector('#query')?.value || '').trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const collection = document.querySelector('#collection-filter')?.value || '';
    const type = document.querySelector('#type-filter')?.value || '';
    const fromValue = document.querySelector('#date-from')?.value || '';
    const toValue = document.querySelector('#date-to')?.value || '';
    const commentsOnly = document.querySelector('#comments-only')?.checked || false;

    const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
    const to = toValue ? new Date(`${toValue}T23:59:59`) : null;
    const date = new Date(post.datePosted);

    return terms.every(term => searchableText(post).includes(term))
      && (!collection || post.collectionId === collection)
      && (!type || post.contentType === type)
      && (!from || date >= from)
      && (!to || date <= to)
      && (!commentsOnly || (post.comments || []).length > 0);
  }

  function searchableText(post) {
    return normalize([
      post.caption,
      post.username,
      post.contentType,
      ...(post.location || []),
      post.altText,
      ...(post.media || []).map(m => m.altText),
      ...(post.comments || []).flatMap(c => [c.username, c.text])
    ].join(' '));
  }

  function normalize(value) {
    return String(value || '').normalize('NFKD').toLowerCase();
  }

  function buildCommentCsv(posts) {
    const headers = [
      'collection_id','collection_title','post_id','shortcode','post_date','post_type','post_username','post_url','post_caption','post_likes','post_comments_reported','post_comments_preserved','post_media_count','comment_username','comment_date','comment_text','comment_likes','comment_replies_reported','comment_url'
    ];

    const rows = [headers];
    for (const post of posts) {
      const comments = post.comments || [];
      if (!comments.length) {
        rows.push([
          post.collectionId, post.collectionTitle, post.id, post.shortcode, post.datePosted, post.contentType, post.username,
          post.url, post.caption, post.likes, post.commentsReported, post.commentsPreserved, (post.media || []).length,
          '', '', '', '', '', ''
        ]);
        continue;
      }
      for (const comment of comments) {
        rows.push([
          post.collectionId, post.collectionTitle, post.id, post.shortcode, post.datePosted, post.contentType, post.username,
          post.url, post.caption, post.likes, post.commentsReported, post.commentsPreserved, (post.media || []).length,
          comment.username, comment.date, comment.text, comment.likes, comment.repliesReported, comment.userUrl || ''
        ]);
      }
    }
    return rows.map(toCsvRow).join('\r\n');
  }

  function buildPostCsv(posts) {
    const headers = [
      'collection_id','collection_title','post_id','shortcode','post_date','post_type','post_username','post_url','post_caption','post_likes','post_comments_reported','post_comments_preserved','post_media_count','comments_count','comments_usernames','comments_dates','comments_text'
    ];

    const rows = [headers];
    for (const post of posts) {
      const comments = post.comments || [];
      rows.push([
        post.collectionId,
        post.collectionTitle,
        post.id,
        post.shortcode,
        post.datePosted,
        post.contentType,
        post.username,
        post.url,
        post.caption,
        post.likes,
        post.commentsReported,
        post.commentsPreserved,
        (post.media || []).length,
        comments.length,
        comments.map(c => c.username).filter(Boolean).join(' | '),
        comments.map(c => c.date).filter(Boolean).join(' | '),
        comments.map(c => `${c.username ? `@${c.username}: ` : ''}${c.text || ''}`).join(' || ')
      ]);
    }
    return rows.map(toCsvRow).join('\r\n');
  }

  function toCsvRow(values) {
    return values.map(v => {
      const text = v === null || v === undefined ? '' : String(v);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',');
  }

  function makeFilename(archive, posts, mode) {
    const date = new Date().toISOString().slice(0, 10);
    const collectionSelect = document.querySelector('#collection-filter');
    const selected = collectionSelect?.value
      ? collectionSelect.selectedOptions?.[0]?.textContent || collectionSelect.value
      : 'all-collections';
    const name = sanitize(selected);
    const suffix = mode === 'post' ? 'posts' : 'comments';
    return `${name}-${suffix}-${date}.csv`;
  }

  function sanitize(value) {
    return String(value || 'collection')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'collection';
  }

  function downloadText(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
