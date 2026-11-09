"""Read-only matching and integrity checks against the actual archived collection."""
import json
import os
from pathlib import Path

archive = json.loads(Path('docs/data/archive.json').read_text(encoding='utf-8'))
recovery = json.loads(Path('docs/data/the-baby-mudang-metadata.json').read_text(encoding='utf-8'))
assert recovery['account'] == 'the.baby.mudang'
recovered = {p['shortcode']: p for p in recovery['posts']}
assert len(recovered) == len(recovery['posts']), 'Duplicate recovered shortcodes'
posts = [p for c in archive['collections'] for p in c.get('posts', []) if (c.get('username') or p.get('username') or '').lstrip('@').lower() == recovery['account']]
assert posts, 'Target collection not found'
codes = {p.get('shortcode') or p['id'] for p in posts}
matched = len(codes & recovered.keys())
missing = sorted(codes - recovered.keys())
extra = sorted(recovered.keys() - codes)
summary = f'{matched} matched; {len(missing)} caption-only; {len(extra)} recovered posts outside archive'
print(summary)
print('Unmatched archived posts:', json.dumps(missing))
print('Recovered posts outside archive:', json.dumps(extra))
if os.environ.get('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
        out.write('coverage=' + summary + '\n')
