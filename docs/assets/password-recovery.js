(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PasswordRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  class Client {
    constructor(config, fetcher = globalThis.fetch.bind(globalThis)) {
      this.url = String(config.supabaseUrl || '').replace(/\/$/, '');
      this.key = config.publishableKey || '';
      this.fetcher = fetcher;
    }
    async request(path, method, body, token) {
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(this.url) || !this.key) throw new Error('Password recovery is not configured.');
      const response = await this.fetcher(this.url + path, {
        method, signal: AbortSignal.timeout(20000),
        headers: { apikey: this.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || `Request failed (${response.status}).`);
      return data;
    }
    send(email, redirectUrl) {
      return this.request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl)}`, 'POST', { email: email.trim() });
    }
    verify(token) { return this.request('/auth/v1/user', 'GET', undefined, token); }
    update(password, token) { return this.request('/auth/v1/user', 'PUT', { password }, token); }
    logout(token) { return this.request('/auth/v1/logout', 'POST', undefined, token); }
  }
  function readLink(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    if (params.has('error') || params.has('error_description')) throw new Error('This reset link is invalid or expired. Request a new link from the archive sign-in form.');
    const token = params.get('access_token');
    if (params.get('type') !== 'recovery' || !token) throw new Error('Open this page using the password reset link sent to your email.');
    return token;
  }
  function validatePassword(password, confirmation) {
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    if (password !== confirmation) throw new Error('The passwords do not match.');
  }
  return { Client, readLink, validatePassword };
});
