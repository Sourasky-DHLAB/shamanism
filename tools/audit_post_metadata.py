"""Inspect available source metadata for one account without changing the archive."""
import json
from collections import Counter
from pathlib import Path

ACCOUNT = 'the.baby.mudang'
archive = json.loads(Path('docs/data/archive.json').read_text(encoding='utf-8'))
posts = [p for c in archive['collections'] for p in c.get('posts', [])
         if (p.get('username') or c.get('username') or '').lstrip('@').lower() == ACCOUNT]
codes = {p.get('shortcode') or p['id'] for p in posts}
print('AUDIT_TARGET ' + json.dumps({'account': ACCOUNT, 'posts': len(posts), 'collectionIds': [c['id'] for c in archive['collections'] if any((p.get('shortcode') or p['id']) in codes for p in c.get('posts', []))]}))
for p in posts:
    print('AUDIT_POST ' + json.dumps({'shortcode': p.get('shortcode') or p['id'], 'url': p.get('url'), 'metadataFields': {k: v for k, v in p.items() if any(w in k.lower() for w in ['tag', 'mention', 'coauthor', 'collab'])}}, ensure_ascii=False))
for path in [Path('sd_msmy6c9e2hdn8fvsse.cleaned.json'), Path('sd_msmym9bn11o4swgpu9.json')]:
    data = json.loads(path.read_text(encoding='utf-8'))
    data = data if isinstance(data, list) else data.get('posts', data.get('data', []))
    matched, counts, samples = 0, Counter(), []
    for p in data:
        code = p.get('shortcode') or p.get('shortCode') or p.get('content_id')
        if code not in codes:
            continue
        matched += 1
        meta = {k: v for k, v in p.items() if any(w in k.lower() for w in ['tag', 'mention', 'coauthor', 'collab'])}
        counts.update({k: 1 for k, v in meta.items() if v})
        if meta and len(samples) < 3:
            samples.append({'shortcode': code, 'fields': meta})
    print('AUDIT_SOURCE ' + json.dumps({'path': str(path), 'matched': matched, 'nonemptyFields': dict(counts), 'samples': samples}, ensure_ascii=False))
