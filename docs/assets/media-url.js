(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArchiveMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const BASE = 'https://d3ond2bpn3cm3y.cloudfront.net/';
  function url(value) {
    const source = String(value || '');
    return source.startsWith('media/') ? BASE + source.slice('media/'.length) : source;
  }
  return { url };
});
