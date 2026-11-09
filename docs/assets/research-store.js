(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Research = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const key = post => String(post.shortcode || post.id);
  const normalizeTag = value => String(value).trim().replace(/\s+/gu, ' ');
  const tagKey = value => normalizeTag(value).toLowerCase();
  function uniqueTags(values) {
    const seen = new Set();
    return values.map(normalizeTag).filter(value => {
      const normalized = tagKey(value);
      if (!value || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
  function matchesTags(tags, selected, mode = 'all') {
    const present = new Set(tags.map(tagKey));
    return !selected.length || (mode === 'any' ? selected.some(t => present.has(tagKey(t))) : selected.every(t => present.has(tagKey(t))));
  }
  class Store {
    constructor(config, fetcher = globalThis.fetch.bind(globalThis), storage = globalThis.sessionStorage) {
      this.url = String(config.supabaseUrl || '').replace(/\/$/, '');
      this.apiKey = config.publishableKey || '';
      this.configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(this.url) && !!this.apiKey;
      this.fetcher = fetcher;
      this.storage = storage;
      this.storageKey = `research-session:${this.url}`;
      this.session = null;
      this.rows = new Map();
      this.generation = 0;
      try { this.session = JSON.parse(storage.getItem(this.storageKey) || 'null'); } catch (_) { /* blocked or empty storage */ }
    }
    get(post) { return this.rows.get(key(post)) || { post_key: key(post), notes: '', tags: [], version: 0 }; }
    remember(session) {
      this.session = session;
      try {
        if (session) this.storage.setItem(this.storageKey, JSON.stringify(session));
        else this.storage.removeItem(this.storageKey);
      } catch (_) { /* session still works in this tab */ }
    }
    async request(path, { method = 'GET', body, auth = true } = {}) {
      if (!this.configured) throw new Error('Shared research storage has not been connected yet.');
      const generation = this.generation;
      if (auth) {
        if (!this.session) throw new Error('Sign in to access researcher annotations.');
        if ((this.session.expires_at || 0) * 1000 < Date.now() + 60000) await this.refresh();
      }
      const response = await this.fetcher(this.url + path, {
        signal: AbortSignal.timeout(20000),
        method,
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${this.session.access_token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const data = await response.json().catch(() => null);
      if (generation !== this.generation) throw new Error('Session changed; sign in again.');
      if (!response.ok) {
        const error = new Error(data?.message || data?.error_description || data?.msg || `Request failed (${response.status}).`);
        error.code = data?.code;
        error.status = response.status;
        throw error;
      }
      return data;
    }
    async refresh() {
      if (!this.refreshing) this.refreshing = (async () => {
        try {
          const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: this.session.refresh_token } });
          this.remember({ ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in });
        } catch (error) {
          this.clear();
          throw new Error('Your session expired. Sign in again; keep a copy of unsaved notes.');
        }
      })().finally(() => { this.refreshing = null; });
      return this.refreshing;
    }
    async login(email, password) {
      const data = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
      this.remember({ ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in });
      try { await this.checkMembership(); await this.load(); } catch (error) { this.clear(); throw error; }
    }
    async checkMembership() {
      const members = await this.request('/rest/v1/researchers?select=user_id,display_name');
      if (!members?.some(row => row.user_id === this.session.user.id)) throw new Error('This account has not been granted access to the research team.');
      this.member = members.find(row => row.user_id === this.session.user.id);
    }
    clear() { this.generation++; this.remember(null); this.rows.clear(); this.member = null; }
    async logout() {
      try { if (this.session) await this.request('/auth/v1/logout', { method: 'POST' }); }
      finally { this.clear(); }
    }
    async load() {
      const generation = this.generation;
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const page = await this.request(`/rest/v1/research_annotations?select=*&order=post_key&limit=500&offset=${offset}`);
        rows.push(...page);
        if (page.length < 500) break;
      }
      if (generation === this.generation) this.rows = new Map(rows.map(row => [row.post_key, row]));
    }
    async save(post, notes, tags, version) {
      const row = await this.request('/rest/v1/rpc/save_research_annotation', { method: 'POST', body: { p_post_key: key(post), p_notes: notes, p_tags: uniqueTags(tags), p_expected_version: version } });
      this.rows.set(row.post_key, row);
      return row;
    }
    async history(post) {
      return this.request(`/rest/v1/research_annotation_history?post_key=eq.${encodeURIComponent(key(post))}&order=version.desc&limit=100`);
    }
    async renameTag(from, to) {
      const count = await this.request('/rest/v1/rpc/rename_research_tag', { method: 'POST', body: { p_from: from, p_to: to } });
      await this.load();
      return count;
    }
  }
  return { Store, key, normalizeTag, tagKey, uniqueTags, matchesTags };
});
