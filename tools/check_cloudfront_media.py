"""Read-only check of current archive links and AWS copies of local media."""
import json
import os
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor

BASE = 'https://d3ond2bpn3cm3y.cloudfront.net/'
archive = json.loads(Path('docs/data/archive.json').read_text(encoding='utf-8'))
media = [m for c in archive['collections'] for p in c.get('posts', []) for m in p.get('media', [])]
hosts = Counter(urlparse(m.get('localPath') or m.get('sourceUrl') or '').hostname or 'relative' for m in media)
local = sorted({m['localPath'] for m in media if str(m.get('localPath') or '').startswith('media/')})
targets = sorted({BASE + path for path in local} | {m['localPath'] for m in media if str(m.get('localPath') or '').startswith(BASE)})
def check(url):
    try:
        with urlopen(Request(url, method='HEAD'), timeout=20) as response:
            return url, response.status, int(response.headers.get('Content-Length', '0'))
    except Exception as error:
        return url, str(error), 0
with ThreadPoolExecutor(max_workers=12) as pool:
    checks = list(pool.map(check, targets))
failed = [r for r in checks if r[1] != 200]
summary = f'{len(media)} media; {len(local)} relative URLs; {len(checks)-len(failed)}/{len(checks)} AWS copies reachable'
print(summary)
print('HOSTS', dict(hosts))
print('FAILED', failed[:20])
if os.environ.get('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
        handle.write('summary=' + summary + '\n')
        handle.write('hosts=' + str(dict(hosts)) + '\n')
assert targets, 'No expected AWS objects identified'
assert not failed, 'Some AWS objects are unavailable; do not exclude local media yet'
