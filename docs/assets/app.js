(() => {
  const state = { archive: null, posts: [], filtered: [], query: '' };
  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Object.assign(els, {
      query: document.querySelector('#query'),
      collection: document.querySelector('#collection-filter'),
      type: document.querySelector('#type-filter'),
      sort: document.querySelector('#sort-filter'),
      from: document.querySelector('#date-from'),
      to: document.querySelector('#date-to'),
      commentsOnly: document.querySelector('#comments-only'),
      clear: document.querySelector('#clear-filters'),
      stats: document.querySelector('#stats'),
      results: document.querySelector('#results'),
      count: document.querySelector('#result-count'),
      empty: document.querySelector('#empty-state'),
      notice: document.querySelector('#notice'),
      dialog: document.querySelector('#post-dialog'),
      dialogContent: document.querySelector('#dialog-content'),
      closeDialog: document.querySelector('#close-dialog')
    });

    bindEvents();
    try {
      const response = await fetch('data/archive.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load archive (${response.status})`);
      state.archive = await response.json();
      state.posts = flattenArchive(state.archive);
      populateFilters();
      renderStats();
      if (state.archive.notice) {
        els.notice.textContent = state.archive.notice;
        els.notice.hidden = false;
      }
      applyFilters();
      openFromHash();
    } catch (error) {
      els.notice.textContent = `${error.message}. Open this site through a local web server rather than directly from the file system.`;
      els.notice.hidden = false;
    }
  }

  function bindEvents() {
    [els.query, els.collection, els.type, els.sort, els.from, els.to, els.commentsOnly]
      .forEach(el => el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', applyFilters));
    els.clear.addEventListener('click', () => {
      els.query.value = '';
      els.collection.value = '';
      els.type.value = '';
      els.sort.value = 'newest';
      els.from.value = '';
      els.to.value = '';
      els.commentsOnly.checked = false;
      applyFilters();
    });
    els.closeDialog.addEventListener('click', closeDialog);
    els.dialog.addEventListener('click', event => { if (event.target === els.dialog) closeDialog(); });
    window.addEventListener('hashchange', openFromHash);
  }

  function flattenArchive(archive) {
    return (archive.collections || []).flatMap(collection =>
      (collection.posts || []).map(post => ({ ...post, collectionId: collection.id, collectionTitle: collection.title }))
    );
  }

  function populateFilters() {
    const collections = [...new Map(state.posts.map(p => [p.collectionId, p.collectionTitle])).entries()];
    for (const [id, title] of collections) els.collection.add(new Option(title, id));
    const types = [...new Set(state.posts.map(p => p.contentType).filter(Boolean))].sort();
    for (const type of types) els.type.add(new Option(type, type));
  }

  function normalize(value) {
    return String(value || '').normalize('NFKD').toLowerCase();
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

  function applyFilters() {
    const query = normalize(els.query.value.trim());
    state.query = els.query.value.trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const from = els.from.value ? new Date(`${els.from.value}T00:00:00`) : null;
    const to = els.to.value ? new Date(`${els.to.value}T23:59:59`) : null;

    let posts = state.posts.filter(post => {
      const date = new Date(post.datePosted);
      const matchesQuery = terms.every(term => searchableText(post).includes(term));
      return matchesQuery
        && (!els.collection.value || post.collectionId === els.collection.value)
        && (!els.type.value || post.contentType === els.type.value)
        && (!from || date >= from)
        && (!to || date <= to)
        && (!els.commentsOnly.checked || (post.comments || []).length > 0);
    });

    const sorters = {
      newest: (a, b) => new Date(b.datePosted) - new Date(a.datePosted),
      oldest: (a, b) => new Date(a.datePosted) - new Date(b.datePosted),
      likes: (a, b) => (b.likes || 0) - (a.likes || 0),
      comments: (a, b) => (b.commentsPreserved || 0) - (a.commentsPreserved || 0)
    };
    posts.sort(sorters[els.sort.value] || sorters.newest);
    state.filtered = posts;
    renderResults();
  }

  function renderStats() {
    const posts = state.posts.length;
    const comments = state.posts.reduce((sum, p) => sum + (p.commentsPreserved || 0), 0);
    const reported = state.posts.reduce((sum, p) => sum + (p.commentsReported || 0), 0);
    const media = state.posts.reduce((sum, p) => sum + (p.media || []).length, 0);
    const values = [
      [posts, 'Posts preserved'],
      [media, 'Media records'],
      [comments, 'Comments preserved'],
      [reported, 'Comments reported']
    ];
    els.stats.innerHTML = values.map(([value, label]) => `<div class="stat"><strong>${formatNumber(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
  }

  function renderResults() {
    els.count.textContent = `${state.filtered.length} of ${state.posts.length} posts`;
    els.empty.hidden = state.filtered.length !== 0;
    els.results.innerHTML = state.filtered.map(renderCard).join('');
    els.results.querySelectorAll('[data-post-id]').forEach(button => {
      button.addEventListener('click', () => openPost(button.dataset.postId));
    });
    installImageFallbacks(els.results);
  }

  function renderCard(post) {
    const media = (post.media || [])[0];
    const captionTitle = firstMeaningfulLine(post.caption) || `${post.contentType || 'Post'} ${post.shortcode}`;
    const captionRemainder = afterFirstMeaningfulLine(post.caption);
    const complete = post.commentsPreserved >= post.commentsReported;
    return `<article class="post-card">
      <div class="media-preview">
        ${renderMedia(media, post, true)}
        <span class="media-badge">${escapeHtml(post.contentType || 'Post')}${(post.media || []).length > 1 ? ` · ${(post.media || []).length}` : ''}</span>
      </div>
      <div class="card-body">
        <div class="card-meta"><span>${escapeHtml(post.collectionTitle)}</span><time datetime="${escapeAttr(post.datePosted)}">${formatDate(post.datePosted)}</time></div>
        <h3>${highlight(captionTitle, state.query)}</h3>
        ${captionRemainder ? `<div class="caption">${highlight(captionRemainder, state.query)}</div>` : ''}
        <span class="completeness ${complete ? '' : 'incomplete'}">${complete ? 'Comments complete for supplied count' : `${post.commentsPreserved} preserved of ${post.commentsReported} reported`}</span>
        <div class="card-footer">
          <span class="metrics">♥ ${formatNumber(post.likes)} · ${formatNumber(post.commentsPreserved)} preserved comments</span>
          <button class="button secondary" data-post-id="${escapeAttr(post.id)}">View post</button>
        </div>
      </div>
    </article>`;
  }

  function renderMedia(media, post, compact = false) {
    if (!media || !media.sourceUrl) return `<div class="media-fallback">No archived media file</div>`;
    const alt = media.altText || post.altText || `Media from Instagram post ${post.shortcode}`;
    if (String(media.type).toLowerCase().includes('video')) {
      return `<video ${compact ? 'muted' : 'controls'} preload="metadata" poster="${escapeAttr(post.thumbnailUrl || '')}"><source src="${escapeAttr(media.localPath || media.sourceUrl)}"></video><div class="media-fallback" hidden>Video unavailable</div>`;
    }
    return `<img src="${escapeAttr(media.localPath || media.sourceUrl)}" alt="${escapeAttr(alt)}" loading="lazy"><div class="media-fallback" hidden>Media URL unavailable. Import a local copy for permanent display.</div>`;
  }

  function installImageFallbacks(root) {
  root.querySelectorAll('img').forEach(img => {
    const fallback = img.nextElementSibling;

    const showFallback = () => {
      img.hidden = true;
      if (fallback?.classList.contains('media-fallback')) {
        fallback.hidden = false;
      }
    };

    const hideFallback = () => {
      img.hidden = false;
      if (fallback?.classList.contains('media-fallback')) {
        fallback.hidden = true;
      }
    };

    if (img.complete) {
      if (img.naturalWidth > 0) {
        hideFallback();
      } else {
        showFallback();
      }
    } else {
      img.addEventListener('load', hideFallback, { once: true });
      img.addEventListener('error', showFallback, { once: true });
    }
  });

  root.querySelectorAll('video').forEach(video => {
    const fallback = video.nextElementSibling;

    const showFallback = () => {
      video.hidden = true;
      if (fallback?.classList.contains('media-fallback')) {
        fallback.hidden = false;
      }
    };

    const hideFallback = () => {
      video.hidden = false;
      if (fallback?.classList.contains('media-fallback')) {
        fallback.hidden = true;
      }
    };

    if (video.readyState >= 1) {
      hideFallback();
    } else {
      video.addEventListener('loadedmetadata', hideFallback, { once: true });
      video.addEventListener('error', showFallback, { once: true });
    }
  });
}

  function openPost(id) {
    const post = state.posts.find(p => p.id === id);
    if (!post) return;
    if (location.hash !== `#post=${encodeURIComponent(id)}`) history.pushState(null, '', `#post=${encodeURIComponent(id)}`);
    renderDialog(post);
    if (!els.dialog.open) els.dialog.showModal();
  }

  function openFromHash() {
    const match = location.hash.match(/^#post=(.+)$/);
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    const post = state.posts.find(p => p.id === id);
    if (post) {
      renderDialog(post);
      if (!els.dialog.open) els.dialog.showModal();
    }
  }

  function closeDialog() {
    els.dialog.close();
    if (location.hash.startsWith('#post=')) history.pushState(null, '', location.pathname + location.search);
  }

  function renderDialog(post) {
    const comments = post.comments || [];
    const gallery = (post.media || []).map((m, i) => `<figure class="media-item">${renderMedia(m, post)}<figcaption class="media-badge">${i + 1} / ${(post.media || []).length}</figcaption></figure>`).join('');
    els.dialogContent.innerHTML = `<div class="detail">
      <header class="detail-header">
        <p class="eyebrow">${escapeHtml(post.collectionTitle)} · ${escapeHtml(post.contentType)}</p>
        <h2>${escapeHtml(firstMeaningfulLine(post.caption) || post.shortcode)}</h2>
        <p class="detail-meta"><time datetime="${escapeAttr(post.datePosted)}">${formatDateTime(post.datePosted)}</time> · ${formatNumber(post.likes)} likes · <a href="${escapeAttr(post.url)}" target="_blank" rel="noopener">Original Instagram post</a></p>
      </header>
      <div class="media-gallery">${gallery || '<div class="media-item"><div class="media-fallback">No media record</div></div>'}</div>
      <h3>Caption</h3>
      <div class="detail-caption">${linkify(escapeHtml(post.caption))}</div>
      <h3>Preserved comments</h3>
      ${comments.length ? `<ul class="comment-list">${comments.map(renderComment).join('')}</ul>` : '<p>No separate comment records were supplied for this post.</p>'}
      <p class="completeness ${post.commentsPreserved < post.commentsReported ? 'incomplete' : ''}">${post.commentsPreserved} preserved of ${post.commentsReported} comments reported by the post export.</p>
      <h3>Provenance</h3>
      <div class="provenance">
        <div><strong>Post shortcode</strong><br>${escapeHtml(post.shortcode)}</div>
        <div><strong>Collected</strong><br>${formatDateTime(post.collectedAt)}</div>
        <div><strong>Location</strong><br>${escapeHtml((post.location || []).join(', ') || 'Not supplied')}</div>
        <div><strong>Media records</strong><br>${formatNumber((post.media || []).length)}</div>
      </div>
    </div>`;
    installImageFallbacks(els.dialogContent);
  }

  function renderComment(comment) {
    return `<li class="comment">
      <div class="comment-head"><strong>${comment.userUrl ? `<a href="${escapeAttr(comment.userUrl)}" target="_blank" rel="noopener">@${escapeHtml(comment.username)}</a>` : `@${escapeHtml(comment.username)}`}</strong><time datetime="${escapeAttr(comment.date)}">${formatDateTime(comment.date)}</time></div>
      <p>${highlight(comment.text, state.query)}</p>
      <small>♥ ${formatNumber(comment.likes)} · ${formatNumber(comment.repliesReported)} replies reported</small>
    </li>`;
  }

  function firstMeaningfulLine(text) {
    return String(text || '').split(/\n+/).map(s => s.trim()).find(Boolean)?.slice(0, 100) || '';
  }

  function afterFirstMeaningfulLine(text) {
    const lines = String(text || '').split(/\n/);
    const firstIndex = lines.findIndex(line => line.trim());
    return firstIndex < 0 ? '' : lines.slice(firstIndex + 1).join('\n').trim();
  }

  function highlight(text, query) {
    const safe = escapeHtml(text || '');
    const terms = String(query || '').trim().split(/\s+/).filter(Boolean).sort((a,b) => b.length - a.length);
    if (!terms.length) return safe;
    const pattern = terms.map(escapeRegExp).join('|');
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  }

  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Not supplied' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function formatNumber(value) { return new Intl.NumberFormat().format(value || 0); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escapeAttr(value) { return escapeHtml(value); }
  function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
})();
