(() => {
  let generated = null;
  const $ = selector => document.querySelector(selector);
  document.addEventListener('DOMContentLoaded', () => {
    $('#validate').addEventListener('click', run);
    $('#download').addEventListener('click', download);
  });

  async function run() {
    const report = [];
    generated = null;
    $('#download').disabled = true;
    try {
      const posts = await readJsonFile($('#posts-file').files[0], 'Posts JSON');
      const comments = await readJsonFile($('#comments-file').files[0], 'Comments JSON');
      const existing = $('#archive-file').files[0]
        ? await readJsonFile($('#archive-file').files[0], 'Existing archive')
        : { schemaVersion: '1.0', generatedAt: new Date().toISOString(), collections: [] };

      if (!Array.isArray(posts)) throw new Error('Posts JSON must contain a top-level array.');
      if (!Array.isArray(comments)) throw new Error('Comments JSON must contain a top-level array.');
      if (!Array.isArray(existing.collections)) throw new Error('Existing archive must contain a collections array.');

      const missingPostFields = posts.filter(p => !(p.shortcode || p.content_id || shortcode(p.url)) || !p.date_posted);
      if (missingPostFields.length) report.push(['error', `${missingPostFields.length} posts lack a shortcode or date.`]);
      else report.push(['ok', `${posts.length} posts passed required-field validation.`]);

      const unmatched = comments.filter(c => !shortcode(c.post_url || c.url));
      if (unmatched.length) report.push(['error', `${unmatched.length} comments do not contain a recognizable post URL.`]);
      else report.push(['ok', `${comments.length} comments contain recognizable post links.`]);

      const normalized = await normalizeCollection(posts, comments, $('#anonymize').checked);
      const suppliedTitle = $('#collection-title').value.trim();
      const suppliedId = slug($('#collection-id').value.trim());
      if (suppliedTitle) normalized.title = suppliedTitle;
      if (suppliedId) normalized.id = suppliedId;

      const reported = normalized.posts.reduce((n, p) => n + p.commentsReported, 0);
      const preserved = normalized.posts.reduce((n, p) => n + p.commentsPreserved, 0);
      if (preserved < reported) report.push(['warning', `${preserved} comments are preserved, while post records report ${reported}. The site will display this discrepancy.`]);
      else report.push(['ok', `Preserved comment count matches or exceeds the reported count (${preserved}).`]);

      const mediaCount = normalized.posts.reduce((n, p) => n + p.media.length, 0);
      report.push(['warning', `${mediaCount} media records use source URLs. CDN links may expire unless media files are downloaded separately.`]);

      const index = existing.collections.findIndex(c => c.id === normalized.id);
      if (index >= 0) {
        existing.collections[index] = mergeCollection(existing.collections[index], normalized);
        report.push(['ok', `Merged into existing collection “${normalized.id}”.`]);
      } else {
        existing.collections.push(normalized);
        report.push(['ok', `Added new collection “${normalized.id}”.`]);
      }
      existing.generatedAt = new Date().toISOString();
      existing.schemaVersion = '1.0';
      existing.notice = 'This archive contains only records present in the supplied export. Reported Instagram comment counts may exceed preserved comments.';
      generated = existing;
      $('#download').disabled = report.some(([level]) => level === 'error');
      $('#output').hidden = false;
      $('#output').textContent = JSON.stringify(generated, null, 2).slice(0, 12000) + (JSON.stringify(generated).length > 12000 ? '\n… preview truncated …' : '');
    } catch (error) {
      report.push(['error', error.message]);
      $('#output').hidden = true;
    }
    $('#validation').innerHTML = report.map(([level, text]) => `<li class="${level}">${escapeHtml(text)}</li>`).join('');
  }

  async function normalizeCollection(posts, comments, anonymize) {
    const commentsByPost = new Map();
    for (const c of comments) {
      const code = shortcode(c.post_url || c.url);
      if (!code) continue;
      const username = c.comment_user || 'Unknown commenter';
      const normalized = {
        id: String(c.comment_id || crypto.randomUUID()),
        username: anonymize ? await pseudonym(username) : username,
        userUrl: anonymize ? null : (c.comment_user_url || null),
        date: c.comment_date || null,
        text: c.comment || '',
        likes: integer(c.likes_number),
        repliesReported: integer(c.replies_number),
        parentCommentId: c.parent_comment_id || null,
        collectedAt: c.timestamp || null
      };
      commentsByPost.set(code, [...(commentsByPost.get(code) || []), normalized]);
    }
    const username = posts.find(p => p.user_posted)?.user_posted || 'unknown-profile';
    return {
      id: slug(username) || 'archive',
      title: `@${username}`,
      username,
      profileUrl: posts.find(p => p.profile_url)?.profile_url || null,
      profileImageUrl: posts.find(p => p.profile_image_link)?.profile_image_link || null,
      followersAtCollection: integer(posts.find(p => p.followers)?.followers),
      postsCountAtCollection: integer(posts.find(p => p.posts_count)?.posts_count),
      description: 'Searchable research archive generated from supplied Instagram export data.',
      posts: posts.map(p => normalizePost(p, commentsByPost)).sort((a,b) => new Date(b.datePosted) - new Date(a.datePosted))
    };
  }

  function normalizePost(p, commentsByPost) {
    const code = p.shortcode || p.content_id || shortcode(p.url);
    const comments = (commentsByPost.get(code) || []).sort((a,b) => new Date(a.date) - new Date(b.date));
    const reported = integer(p.num_comments);
    let media = Array.isArray(p.post_content) ? p.post_content : [];
    if (!media.length && Array.isArray(p.photos)) media = p.photos.map((url, index) => ({ index, type: 'Photo', url, alt_text: p.alt_text }));
    return {
      id: code,
      shortcode: code,
      url: p.url || null,
      username: p.user_posted || null,
      caption: p.description || '',
      datePosted: p.date_posted || null,
      likes: integer(p.likes),
      commentsReported: reported,
      commentsPreserved: comments.length,
      commentsMissing: Math.max(0, reported - comments.length),
      contentType: p.content_type || 'Unknown',
      productType: p.product_type || null,
      thumbnailUrl: p.thumbnail || null,
      location: Array.isArray(p.location) ? p.location : (p.location ? [p.location] : []),
      locationDetails: p.location_details || null,
      altText: p.alt_text || '',
      media: media.map((m, index) => ({
        index: integer(m.index ?? index), type: m.type || 'Unknown', sourceUrl: m.url || null,
        localPath: null, id: m.id == null ? null : String(m.id), altText: m.alt_text || p.alt_text || ''
      })).sort((a,b) => a.index - b.index),
      comments,
      audio: p.audio || null,
      isPaidPartnership: Boolean(p.is_paid_partnership),
      partnershipDetails: p.partnership_details || null,
      collectedAt: p.timestamp || null
    };
  }

  function mergeCollection(oldCollection, incoming) {
    const posts = new Map((oldCollection.posts || []).map(p => [p.id, p]));
    for (const post of incoming.posts) {
      if (!posts.has(post.id)) {
        posts.set(post.id, post);
        continue;
      }

      const old = posts.get(post.id);
      const comments = new Map((old.comments || []).map(c => [c.id, c]));
      for (const comment of post.comments || []) comments.set(comment.id, comment);

      const oldMedia = new Map((old.media || []).map(item => [
        String(item.id || `index:${item.index}`),
        item
      ]));
      const media = (post.media || []).map(item => {
        const previous = oldMedia.get(String(item.id || `index:${item.index}`));
        return !item.localPath && previous?.localPath
          ? { ...item, localPath: previous.localPath }
          : item;
      });

      const merged = {
        ...old,
        ...post,
        media,
        comments: [...comments.values()].sort((a,b) => new Date(a.date) - new Date(b.date)),
        commentsPreserved: comments.size
      };
      merged.commentsMissing = Math.max(0, integer(merged.commentsReported) - comments.size);
      posts.set(post.id, merged);
    }
    return {
      ...oldCollection,
      ...incoming,
      posts: [...posts.values()].sort((a,b) => new Date(b.datePosted) - new Date(a.datePosted))
    };
  }

  async function pseudonym(username) {
    const data = new TextEncoder().encode(username.toLowerCase());
    const hash = await crypto.subtle.digest('SHA-256', data);
    const code = [...new Uint8Array(hash)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `Commenter-${code}`;
  }

  function shortcode(url) { return String(url || '').match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] || null; }
  function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''); }
  function integer(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
  async function readJsonFile(file, label) { if (!file) throw new Error(`${label} is required.`); return JSON.parse(await file.text()); }
  function download() {
    if (!generated) return;
    const blob = new Blob([JSON.stringify(generated, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'archive.json'; a.click(); URL.revokeObjectURL(url);
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
