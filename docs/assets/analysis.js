(() => {
  const els = {};
  const state = { archive: null, posts: [], filtered: [] };

  const STOP_WORDS = new Set([
    'a','an','and','are','as','at','be','by','for','from','has','he','in','is','it','its','of','on','that','the','to','was','were','will','with','i','you','your','we','they','them','their','this','those','these','or','not','but','if','then','than','so','too','very','can','could','should','would','may','might','into','over','under','about','after','before','between','among','through','during','again','further','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','only','own','same','s','t','d','ll','m','o','re','ve','y','ma'
  ]);

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Object.assign(els, {
      notice: document.querySelector('#notice'),
      collection: document.querySelector('#collection-filter'),
      type: document.querySelector('#type-filter'),
      from: document.querySelector('#date-from'),
      to: document.querySelector('#date-to'),
      commentsOnly: document.querySelector('#comments-only'),
      sourceMode: document.querySelector('#source-mode'),
      removeStopwords: document.querySelector('#remove-stopwords'),
      caseSensitive: document.querySelector('#case-sensitive'),
      ngramSize: document.querySelector('#ngram-size'),
      windowSize: document.querySelector('#window-size'),
      contextSize: document.querySelector('#context-size'),
      kwicTerm: document.querySelector('#kwic-term'),
      runBtn: document.querySelector('#run-btn'),
      clearBtn: document.querySelector('#clear-btn'),
      summary: document.querySelector('#summary'),
      frequencyOutput: document.querySelector('#frequency-output'),
      collocationOutput: document.querySelector('#collocation-output'),
      ngramsOutput: document.querySelector('#ngrams-output'),
      kwicOutput: document.querySelector('#kwic-output')
    });

    bindEvents();

    try {
      const response = await fetch('data/archive.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load archive (${response.status})`);
      state.archive = await response.json();
      state.posts = flattenArchive(state.archive);
      populateFilters();
      if (state.archive.notice) {
        els.notice.textContent = state.archive.notice;
        els.notice.hidden = false;
      }
      runAnalysis();
    } catch (error) {
      els.notice.textContent = `${error.message}. Open this site through a local web server rather than directly from the file system.`;
      els.notice.hidden = false;
    }
  }

  function bindEvents() {
    [els.collection, els.type, els.from, els.to, els.commentsOnly, els.sourceMode, els.removeStopwords, els.caseSensitive, els.ngramSize, els.windowSize, els.contextSize]
      .forEach(el => el.addEventListener('change', runAnalysis));
    els.runBtn.addEventListener('click', runAnalysis);
    els.clearBtn.addEventListener('click', () => {
      els.collection.value = '';
      els.type.value = '';
      els.from.value = '';
      els.to.value = '';
      els.commentsOnly.checked = false;
      els.sourceMode.value = 'both';
      els.removeStopwords.checked = true;
      els.caseSensitive.checked = false;
      els.ngramSize.value = 2;
      els.windowSize.value = 4;
      els.contextSize.value = 6;
      els.kwicTerm.value = '';
      runAnalysis();
    });
    document.querySelectorAll('.tab').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
        button.classList.add('active');
        document.querySelector(`#${button.dataset.panel}`).classList.add('active');
      });
    });
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

  function runAnalysis() {
    state.filtered = filterPosts(state.posts);
    const docs = buildDocuments(state.filtered);
    const tokens = docs.flatMap(doc => tokenize(doc.text, !els.caseSensitive.checked));
    const tokenStream = els.removeStopwords.checked ? tokens.filter(token => !STOP_WORDS.has(token)) : tokens;

    renderSummary(docs, tokenStream);
    renderWordFrequency(tokenStream);
    renderCollocations(docs);
    renderNgrams(tokenStream);
    renderKwic(docs);
  }

  function filterPosts(posts) {
    const from = els.from.value ? new Date(`${els.from.value}T00:00:00`) : null;
    const to = els.to.value ? new Date(`${els.to.value}T23:59:59`) : null;
    return posts.filter(post => {
      const date = new Date(post.datePosted);
      return (!els.collection.value || post.collectionId === els.collection.value)
        && (!els.type.value || post.contentType === els.type.value)
        && (!from || date >= from)
        && (!to || date <= to)
        && (!els.commentsOnly.checked || (post.comments || []).length > 0);
    });
  }

  function buildDocuments(posts) {
    const mode = els.sourceMode.value;
    return posts.map(post => {
      let parts = [];
      if (mode === 'both' || mode === 'captions') parts.push(post.caption || '');
      if (mode === 'both' || mode === 'comments') parts.push((post.comments || []).map(c => c.text || '').join(' '));
      if (mode === 'both' || mode === 'alt') parts.push(post.altText || '', ...(post.media || []).map(m => m.altText || ''));
      return {
        ...post,
        text: parts.filter(Boolean).join(' ')
      };
    }).filter(doc => doc.text.trim().length > 0);
  }

  function renderSummary(docs, tokens) {
    const posts = state.filtered.length;
    const comments = state.filtered.reduce((sum, post) => sum + (post.commentsPreserved || 0), 0);
    const media = state.filtered.reduce((sum, post) => sum + (post.media || []).length, 0);
    els.summary.innerHTML = [
      ['Posts', posts],
      ['Documents', docs.length],
      ['Tokens', tokens.length],
      ['Comments', comments],
      ['Media', media]
    ].map(([label, value]) => `<span class="pill"><strong>${formatNumber(value)}</strong> ${escapeHtml(label)}</span>`).join('');
  }

  function renderWordFrequency(tokens) {
    const counts = countTerms(tokens);
    const rows = counts.slice(0, 50).map(([term, count]) => `<tr><td>${escapeHtml(term)}</td><td>${formatNumber(count)}</td></tr>`).join('');
    els.frequencyOutput.innerHTML = rows ? tableWrap('Term', 'Count', rows) : emptyState('No tokens matched your filters.');
  }

  function renderCollocations(docs) {
    const windowSize = clampInt(els.windowSize.value, 2, 10);
    const pairMap = new Map();
    const freq = new Map();
    let totalTokens = 0;

    for (const doc of docs) {
      const tokens = tokenize(doc.text, !els.caseSensitive.checked).filter(token => !els.removeStopwords.checked || !STOP_WORDS.has(token));
      totalTokens += tokens.length;
      tokens.forEach(token => freq.set(token, (freq.get(token) || 0) + 1));
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < Math.min(tokens.length, i + windowSize + 1); j++) {
          const a = tokens[i];
          const b = tokens[j];
          if (!a || !b || a === b) continue;
          const key = a < b ? `${a}|||${b}` : `${b}|||${a}`;
          pairMap.set(key, (pairMap.get(key) || 0) + 1);
        }
      }
    }

    const rowsData = [...pairMap.entries()].map(([key, count]) => {
      const [a, b] = key.split('|||');
      const fa = freq.get(a) || 1;
      const fb = freq.get(b) || 1;
      const pmi = Math.log2((count * Math.max(totalTokens, 1)) / (fa * fb));
      return { a, b, count, pmi };
    }).sort((x, y) => y.count - x.count || y.pmi - x.pmi).slice(0, 50);

    const rows = rowsData.map(row => `<tr><td>${escapeHtml(row.a)}</td><td>${escapeHtml(row.b)}</td><td>${formatNumber(row.count)}</td><td>${row.pmi.toFixed(2)}</td></tr>`).join('');
    els.collocationOutput.innerHTML = rows ? tableWrap('Word 1', 'Word 2', rows, ['Count', 'PMI']) : emptyState('No collocations found for the current subset.');
  }

  function renderNgrams(tokens) {
    const n = clampInt(els.ngramSize.value, 2, 5);
    const counts = new Map();
    for (let i = 0; i <= tokens.length - n; i++) {
      const gram = tokens.slice(i, i + n).join(' ');
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    const rowsData = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    const rows = rowsData.map(([gram, count]) => `<tr><td>${escapeHtml(gram)}</td><td>${formatNumber(count)}</td></tr>`).join('');
    els.ngramsOutput.innerHTML = rows ? tableWrap(`${n}-gram`, 'Count', rows) : emptyState('No n-grams found for the current subset.');
  }

  function renderKwic(docs) {
    const term = String(els.kwicTerm.value || '').trim();
    const contextSize = clampInt(els.contextSize.value, 3, 20);
    if (!term) {
      els.kwicOutput.innerHTML = emptyState('Type a KWIC term to see concordance lines.');
      return;
    }

    const caseSensitive = els.caseSensitive.checked;
    const needle = normalizeForSearch(term, caseSensitive);
    const lines = [];

    for (const doc of docs) {
      const tokens = tokenize(doc.text, !caseSensitive);
      for (let i = 0; i < tokens.length; i++) {
        if (normalizeForSearch(tokens[i], caseSensitive) !== needle) continue;
        const left = tokens.slice(Math.max(0, i - contextSize), i).join(' ');
        const right = tokens.slice(i + 1, i + 1 + contextSize).join(' ');
        lines.push({ left, hit: tokens[i], right, doc });
        if (lines.length >= 100) break;
      }
      if (lines.length >= 100) break;
    }

    if (!lines.length) {
      els.kwicOutput.innerHTML = emptyState('No KWIC matches in the current subset.');
      return;
    }

    els.kwicOutput.innerHTML = lines.map(line => `
      <div class="kwic-item">
        <div class="kwic-line">${escapeHtml(line.left)} <span class="hit">${escapeHtml(line.hit)}</span> ${escapeHtml(line.right)}</div>
        <div class="result-meta">
          <span>${escapeHtml(line.doc.collectionTitle || '')}</span>
          <span>${escapeHtml(line.doc.contentType || '')}</span>
          <span>${formatDate(line.doc.datePosted)}</span>
          <span>${formatNumber((line.doc.comments || []).length)} comments</span>
        </div>
      </div>
    `).join('');
  }

  function countTerms(tokens) {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  function tokenize(text, normalize = true) {
    const source = String(text || '');
    const value = normalize ? source.normalize('NFKD').toLowerCase() : source;
    const matches = value.match(/\p{L}[\p{L}\p{N}'’_-]*/gu);
    return matches ? matches.map(token => token.replace(/[’]/g, "'")).filter(Boolean) : [];
  }

  function normalizeForSearch(text, caseSensitive) {
    const value = String(text || '').normalize('NFKD');
    return caseSensitive ? value : value.toLowerCase();
  }

  function tableWrap(head1, head2, rows, extraHeaders = []) {
    const headers = [head1, head2, ...extraHeaders];
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function emptyState(message) {
    return `<p class="muted">${escapeHtml(message)}</p>`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
  }

  function clampInt(value, min, max) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
})();
