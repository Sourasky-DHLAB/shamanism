(() => {
  'use strict';
  const store = new Research.Store(window.RESEARCH_CONFIG || {});
  const selected = new Set();
  let callbacks, posts = [], editor = null, refreshing = false;
  const $ = (selector, root = document) => root.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tags = post => store.get(post).tags;
  const active = () => !!store.session && !!store.member;
  const dirty = () => !!editor && (editor.notes.value !== editor.base.notes || JSON.stringify(Research.uniqueTags(editor.tags)) !== JSON.stringify(Research.uniqueTags(editor.base.tags)) || !!$('#research-new-tag', editor.panel)?.value.trim());
  const message = (text, isError = false) => {
    const status = $('#research-status');
    status.textContent = text;
    status.classList.toggle('research-error', isError);
  };
  const notify = () => { renderOverview(); callbacks?.changed(); };
  function counts() {
    const map = new Map();
    for (const post of posts) for (const tag of tags(post)) {
      const normalized = Research.tagKey(tag);
      const entry = map.get(normalized) || { tag, count: 0 };
      entry.count++;
      map.set(normalized, entry);
    }
    return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  }
  function mount() {
    const section = document.createElement('section');
    section.className = 'panel research-panel';
    section.setAttribute('aria-labelledby', 'research-heading');
    section.innerHTML = `<h2 id="research-heading">Research workspace</h2>
      <p id="research-status" role="status" aria-live="polite"></p>
      <form id="research-login" hidden>
        <label>Email <input name="email" type="email" required autocomplete="username"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <button class="button" type="submit">Researcher sign in</button>
        <button id="forgot-password" class="research-text-button" type="button">Forgot password?</button>
      </form>
      <form id="research-recovery" hidden>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <button class="button" type="submit">Send reset link</button>
        <button id="recovery-back" class="button secondary" type="button">Back to sign in</button>
      </form>
      <div id="research-team" hidden>
        <div class="research-actions"><span id="research-user"></span>
          <button id="research-refresh" class="button secondary" type="button">Refresh annotations</button>
          <button id="research-export" class="button secondary" type="button">Export annotations</button>
          <button id="research-logout" class="button secondary" type="button">Sign out</button>
        </div>
        <details open><summary>Tags overview</summary>
          <p>Select tags to filter posts. Select a tag again to remove it.</p>
          <label>Combine selected tags <select id="research-tag-mode"><option value="all">Match all selected tags</option><option value="any">Match any selected tag</option></select></label>
          <div id="research-tags" class="research-tags"></div>
          <button id="research-clear-tags" type="button" class="button secondary">Clear tag filter</button>
        </details>
        <details><summary>Rename or merge a tag</summary>
          <form id="research-rename">
            <label>Existing tag <select name="from" required></select></label>
            <label>New or existing name <input name="to" required maxlength="120" list="research-tag-suggestions" dir="auto"></label>
            <button class="button secondary" type="submit">Rename / merge across posts</button>
          </form>
        </details>
      </div><datalist id="research-tag-suggestions"></datalist>`;
    document.querySelector('main').prepend(section);
    $('#research-login').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = $('button', form);
      button.disabled = true;
      try {
        await store.login(form.elements.email.value.trim(), form.elements.password.value);
        form.reset(); renderAccount(); notify(); message('Shared annotations loaded.');
      } catch (error) { message(error.message, true); }
      finally { form.elements.password.value = ''; button.disabled = false; }
    });
    $('#forgot-password').addEventListener('click', () => {
      $('#research-recovery').elements.email.value = $('#research-login').elements.email.value;
      $('#research-login').hidden = true;
      $('#research-recovery').hidden = false;
      message('Enter your researcher email to request a password reset link.');
      $('#research-recovery').elements.email.focus();
    });
    $('#recovery-back').addEventListener('click', () => {
      renderAccount(); message('Sign in to read and edit shared research notes and tags.');
    });
    $('#research-recovery').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = $('button[type=submit]', form);
      button.disabled = true;
      try {
        const client = new PasswordRecovery.Client(window.RESEARCH_CONFIG || {});
        await client.send(form.elements.email.value, new URL('reset-password.html', window.location.href).href);
        message('If this email belongs to an account, a password reset link will be sent. Check your inbox and spam folder.');
      } catch (error) { message('Could not send a reset link: ' + error.message, true); }
      finally { button.disabled = false; }
    });
    $('#research-logout').addEventListener('click', async () => {
      if (dirty() && !confirm('Discard unsaved annotation changes and sign out?')) return;
      editor = null;
      try { await store.logout(); } catch (_) { /* clear() runs even if server logout fails */ }
      selected.clear(); renderAccount(); notify();
      const panel = $('#research-editor'); if (panel) panel.remove();
      message('Signed out. Research annotations are hidden.');
    });
    $('#research-refresh').addEventListener('click', refresh);
    $('#research-tag-mode').addEventListener('change', () => callbacks?.changed());
    $('#research-clear-tags').addEventListener('click', () => { selected.clear(); notify(); });
    $('#research-export').addEventListener('click', () => {
      const snapshot = { exportedAt: new Date().toISOString(), annotations: [...store.rows.values()] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'research-annotations.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('#research-rename').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = $('button', form);
      const from = form.elements.from.value, to = Research.normalizeTag(form.elements.to.value);
      if (!from || !to) return;
      if (!confirm(`Rename “${from}” to “${to}” across all posts? If that tag already exists, their assignments will be merged. Open drafts may need to be reconciled.`)) return;
      button.disabled = true;
      try {
        const count = await store.renameTag(from, to);
        if (selected.delete(Research.tagKey(from))) selected.add(Research.tagKey(to));
        form.elements.to.value = ''; notify(); message(`Updated ${count} posts. Changes are recorded in each post’s history.`);
      } catch (error) { message(error.message); }
      finally { button.disabled = false; }
    });
    window.addEventListener('beforeunload', event => {
      if (dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    // Poll only updates the shared cache and results; an open editor keeps its draft.
    setInterval(() => { if (active() && !document.hidden) refresh(true); }, 30000);
    document.addEventListener('visibilitychange', () => { if (active() && !document.hidden) refresh(true); });
  }
  function renderAccount() {
    $('#research-recovery').hidden = true;
    $('#research-login').hidden = !store.configured || active();
    $('#research-team').hidden = !active();
    $('#research-user').textContent = active() ? `Signed in as ${store.member.display_name}` : '';
  }
  function renderOverview() {
    const items = active() ? counts() : [];
    for (const tag of selected) if (!items.some(item => Research.tagKey(item.tag) === tag)) items.push({ tag, count: 0 });
    $('#research-tags').innerHTML = items.length ? items.map(({ tag, count }) => `<button type="button" class="research-tag" aria-pressed="${selected.has(Research.tagKey(tag))}" data-tag="${escape(Research.tagKey(tag))}">${escape(tag)} <span>(${count})</span></button>`).join('') : '<p>No tags assigned yet. Open a post to add the first one.</p>';
    $('#research-tags').querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => {
      if (selected.has(button.dataset.tag)) selected.delete(button.dataset.tag); else selected.add(button.dataset.tag);
      notify();
    }));
    const select = $('#research-rename select'), previous = select.value;
    select.innerHTML = '<option value="">Choose a tag</option>' + items.map(({ tag }) => `<option>${escape(tag)}</option>`).join('');
    select.value = previous;
    $('#research-tag-suggestions').innerHTML = items.map(({ tag }) => `<option value="${escape(tag)}"></option>`).join('');
  }
  async function refresh(quiet = false) {
    if (refreshing || !active()) return;
    refreshing = true;
    try {
      await store.checkMembership(); await store.load(); notify();
      if (!quiet) message('Shared annotations refreshed. Open drafts are unchanged.');
      if (editor && store.get(editor.post).version !== editor.base.version) {
        editor.status.textContent = 'A newer revision is available. Your draft is preserved. Review history or load the latest revision before saving.';
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403 || !store.session || /not been granted/.test(error.message)) {
        store.clear(); selected.clear(); renderAccount(); notify();
        if (editor) { editor.save.disabled = true; editor.status.textContent = 'Access ended. Copy unsaved notes, sign in, and reopen this post.'; }
      }
      message(`Annotations could not be refreshed: ${error.message}`);
    } finally { refreshing = false; }
  }
  function mountEditor(post, root) {
    editor = null;
    if (!active()) return;
    const panel = document.createElement('section');
    panel.className = 'research-editor'; panel.id = 'research-editor';
    panel.innerHTML = `<h3>Research annotations</h3><p>Notes and tags are shared with the research team.</p>
      <label>Shared notes<textarea id="research-notes" rows="6" maxlength="100000" dir="auto"></textarea></label>
      <label>Add a tag <input id="research-new-tag" list="research-tag-suggestions" maxlength="120" dir="auto" placeholder="e.g. Spiritual but not Religious"></label>
      <button id="research-add-tag" type="button" class="button secondary">Add tag</button>
      <div id="research-editor-tags" class="research-tags"></div>
      <div class="research-actions">
        <button id="research-save" class="button" type="button">Save shared annotations</button>
        <button id="research-latest" class="button secondary" type="button">Load latest revision</button>
        <button id="research-history" class="button secondary" type="button">View history</button>
      </div><p id="research-editor-status" role="status" aria-live="polite"></p>
      <div id="research-history-list"></div>`;
    const captionHeading = [...root.querySelectorAll('h3')].find(el => el.textContent === 'Preserved comments');
    root.querySelector('.detail').insertBefore(panel, captionHeading);
    const base = structuredClone(store.get(post));
    const e = editor = { post, base, tags: [...base.tags], notes: $('#research-notes', panel), status: $('#research-editor-status', panel), save: $('#research-save', panel), panel };
    e.notes.value = base.notes;
    const revisionLabel = () => { e.status.textContent = e.base.version ? `Revision ${e.base.version} · ${e.base.updated_by_name} · ${new Date(e.base.updated_at).toLocaleString()}` : 'No annotations saved yet.'; };
    const renderTags = () => {
      $('#research-editor-tags', panel).innerHTML = e.tags.map((tag, index) => `<button class="research-tag" type="button" data-index="${index}" aria-label="Remove tag ${escape(tag)}">${escape(tag)} ×</button>`).join('');
      $('#research-editor-tags', panel).querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => { e.tags.splice(Number(button.dataset.index), 1); renderTags(); }));
    };
    const addTag = () => {
      const input = $('#research-new-tag', panel), label = Research.normalizeTag(input.value);
      if (!label) return true;
      if (e.tags.length >= 50) { e.status.textContent = 'A post can have up to 50 tags.'; return false; }
      if (label.length > 120) { e.status.textContent = 'A tag can contain up to 120 characters.'; return false; }
      e.tags = Research.uniqueTags([...e.tags, label]); input.value = ''; renderTags(); e.status.textContent = 'Unsaved changes.'; return true;
    };
    $('#research-add-tag', panel).addEventListener('click', addTag);
    $('#research-new-tag', panel).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } });
    e.notes.addEventListener('input', () => { e.status.textContent = 'Unsaved changes.'; });
    e.save.addEventListener('click', async () => {
      if ($('#research-new-tag', panel).value.trim() && !addTag()) return;
      e.save.disabled = true;
      panel.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
      try {
        const saved = await store.save(post, e.notes.value, e.tags, e.base.version);
        e.base = structuredClone(saved);
        if (e.notes.value === saved.notes) { e.tags = [...saved.tags]; renderTags(); revisionLabel(); }
        else e.status.textContent = `Revision ${saved.version} saved. You have newer unsaved changes.`;
        notify();
      } catch (error) {
        e.status.textContent = error.code === '40001' ? 'Another researcher saved changes first. Your draft has been kept. View history to compare, then copy your draft before loading the latest revision.' : `Save failed. Your draft is still here. ${error.message}`;
      } finally { panel.querySelectorAll('button, input').forEach(control => { control.disabled = !active(); }); }
    });
    $('#research-latest', panel).addEventListener('click', async () => {
      if (dirty() && !confirm('Replace your unsaved draft with the latest shared revision? Copy any text you want to keep first.')) return;
      try {
        await store.load(); e.base = structuredClone(store.get(post)); e.notes.value = e.base.notes; $('#research-new-tag', panel).value = ''; e.tags = [...e.base.tags]; renderTags(); revisionLabel(); notify();
      } catch (error) { e.status.textContent = error.message; }
    });
    $('#research-history', panel).addEventListener('click', async () => {
      try {
        const history = await store.history(post);
        const list = $('#research-history-list', panel);
        list.innerHTML = '<p>Latest 100 revisions. Restoring creates a draft; save it as a new revision.</p>' + history.map((row, i) => `<details><summary>Revision ${row.version} · ${escape(row.updated_by_name)} · ${escape(new Date(row.updated_at).toLocaleString())}</summary><p>${row.tags.map(escape).join(' · ') || 'No tags'}</p><pre dir="auto">${escape(row.notes)}</pre><button class="button secondary" type="button" data-restore="${i}">Use this revision as draft</button></details>`).join('');
        list.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => {
          if (dirty() && !confirm('Replace your unsaved draft with this revision?')) return;
          const row = history[Number(button.dataset.restore)];
          e.notes.value = row.notes; e.tags = [...row.tags]; renderTags();
          e.status.textContent = `Revision ${row.version} loaded as an unsaved draft. Save to create a new revision.`;
        }));
      } catch (error) { e.status.textContent = error.message; }
    });
    revisionLabel(); renderTags();
  }
  window.ResearchUI = {
    async init(hooks) {
      callbacks = hooks; mount(); renderAccount();
      if (!store.configured) { message('Shared research annotations have not been connected yet. The archive remains available.'); return; }
      if (store.session) {
        try { await store.checkMembership(); await store.load(); renderAccount(); message('Shared annotations loaded.'); }
        catch (error) { store.clear(); renderAccount(); message(error.message); }
      } else message('Sign in to read and edit shared research notes and tags.');
    },
    setPosts(value) { posts = value; renderOverview(); },
    annotation(post) { return active() ? structuredClone(store.get(post)) : null; },
    searchText(post) { const row = store.get(post); return active() ? [row.notes, ...row.tags].join(' ') : ''; },
    matches(post) { return Research.matchesTags(tags(post), [...selected], $('#research-tag-mode')?.value || 'all'); },
    badges(post) { return active() ? `<div class="research-tags">${tags(post).map(tag => `<span class="research-tag">${escape(tag)}</span>`).join('')}</div>` : ''; },
    resetFilters() { selected.clear(); if ($('#research-tag-mode')) $('#research-tag-mode').value = 'all'; renderOverview(); },
    canLeave() { return !dirty() || confirm('Discard unsaved annotation changes?'); },
    closeEditor() { editor = null; },
    mountEditor
  };
})();

