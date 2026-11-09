"""Browser integration with a mocked shared API; does not validate PostgreSQL policies.
Run: python tests/research-browser.py
Requires the Playwright Python package and Chromium.
"""
import copy
import json
import re
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'docs')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    rows, history = {}, {}
    post = {'id': 'archive-id-1', 'shortcode': 'TEST1', 'caption': 'First post', 'datePosted': '2026-01-01', 'contentType': 'Image', 'comments': [], 'commentsPreserved': 0, 'commentsReported': 0}
    archive = {'collections': [{'id': 'collection', 'title': 'Test collection', 'username': 'the.baby.mudang', 'posts': [post, {**post, 'id': 'archive-id-2', 'shortcode': 'TEST2', 'caption': 'Second post'}]}]}
    def api(route):
        cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
        if route.request.method == 'OPTIONS':
            route.fulfill(status=204, headers=cors)
            return
        path = urlparse(route.request.url).path
        body = route.request.post_data_json or {}
        status, data = 200, []
        if path == '/auth/v1/token':
            who = body.get('email', 'a').split('@')[0]
            data = {'access_token': who, 'refresh_token': who, 'expires_in': 3600, 'user': {'id': who}}
        elif path == '/auth/v1/logout':
            data = {}
        elif path.endswith('/researchers'):
            who = route.request.headers.get('authorization', '').replace('Bearer ', '')
            data = [{'user_id': who, 'display_name': who}] if who != 'stranger' else []
        elif path.endswith('/save_research_annotation'):
            k = body['p_post_key']; current = rows.get(k, {'version': 0})
            if body['p_expected_version'] != current['version']:
                status, data = 409, {'code': '40001', 'message': 'conflict'}
            else:
                who = route.request.headers.get('authorization', '').replace('Bearer ', '')
                data = {'post_key': k, 'notes': body['p_notes'], 'tags': body['p_tags'], 'version': current['version'] + 1, 'updated_at': '2026-11-09T09:00:00Z', 'updated_by_name': who}
                rows[k] = copy.deepcopy(data); history.setdefault(k, []).insert(0, copy.deepcopy(data))
        elif path.endswith('/research_annotation_history'):
            k = parse_qs(urlparse(route.request.url).query)['post_key'][0][3:]
            data = history.get(k, [])
        elif path.endswith('/research_annotations'):
            data = list(rows.values())
        elif path.endswith('/rename_research_tag'):
            data = 0
            for row in rows.values():
                if body['p_from'] in row['tags']:
                    row['tags'] = list(dict.fromkeys(body['p_to'] if t == body['p_from'] else t for t in row['tags']))
                    row['version'] += 1; history[row['post_key']].insert(0, copy.deepcopy(row)); data += 1
        route.fulfill(status=status, content_type='application/json', headers=cors, body=json.dumps(data))
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        contexts = [browser.new_context() for _ in range(3)]
        pages = []
        errors = []
        for context in contexts:
            context.route('**/data/the-baby-mudang-metadata.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps({'account':'the.baby.mudang','retrievedAt':'2026-11-09T08:48:06Z','posts':[{'shortcode':'TEST1','ownerUsername':'publisher','mentions':['mentioned'],'hashtags':['korean'],'taggedUsers':[{'username':'tagged'}],'collaborators':[{'username':'collaborator'}]}]})))
            context.route('**/data/archive.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(archive)))
            context.route('https://test.supabase.co/**', api)
            context.route('**/research-config.js', lambda r: r.fulfill(content_type='application/javascript', body="window.RESEARCH_CONFIG={supabaseUrl:'https://test.supabase.co',publishableKey:'public-test'}"))
            page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin); expect(page.locator('.post-card')).to_have_count(2); pages.append(page)
        for page, who in zip(pages[:2], ['alice', 'bob']):
            page.locator('#research-login input[name=email]').fill(f'{who}@example.test')
            page.locator('#research-login input[name=password]').fill('test-password')
            page.get_by_role('button', name='Researcher sign in').click()
            expect(page.locator('#research-user')).to_contain_text(who)
            page.locator('[data-post-id="archive-id-1"]').click()
        a, b, stranger = pages
        expect(a.locator('.provenance')).to_contain_text('Instagram hashtags')
        expect(a.locator('.provenance a[href="https://www.instagram.com/collaborator/"]')).to_have_text('@collaborator')
        stranger.locator('#query').fill('#korean'); expect(stranger.locator('.post-card')).to_have_count(1)
        stranger.locator('#clear-filters').click()
        a.locator('#research-notes').fill('הערות מחקר\nShared notes <script>bad()</script>')
        a.locator('#research-new-tag').fill('Spiritual but not Religious')
        a.get_by_role('button', name='Add tag', exact=True).click()
        a.locator('#research-new-tag').fill('educational')
        a.get_by_role('button', name='Add tag', exact=True).click()
        a.locator('#research-save').click()
        expect(a.locator('#research-editor-status')).to_contain_text('Revision 1')
        b.locator('#research-notes').fill('Bob’s conflicting draft')
        b.locator('#research-save').click()
        expect(b.locator('#research-editor-status')).to_contain_text('Your draft has been kept')
        expect(b.locator('#research-notes')).to_have_value('Bob’s conflicting draft')
        b.locator('#research-history').click()
        expect(b.locator('#research-history-list')).to_contain_text('Shared notes <script>bad()</script>')
        b.once('dialog', lambda dialog: dialog.accept())
        b.locator('#research-latest').click()
        expect(b.locator('#research-notes')).to_have_value(re.compile('Shared notes'))
        b.locator('#research-notes').fill('Agreed team revision')
        b.locator('#research-save').click(); expect(b.locator('#research-editor-status')).to_contain_text('Revision 2')
        b.locator('#close-dialog').click()
        b.locator('#research-tags button', has_text='educational').click()
        expect(b.locator('.post-card')).to_have_count(1)
        b.locator('#query').fill('Agreed team revision'); expect(b.locator('.post-card')).to_have_count(1)
        b.locator('#clear-filters').click(); expect(b.locator('.post-card')).to_have_count(2)
        b.locator('#research-rename').evaluate('(el) => el.parentElement.open = true')
        b.locator('#research-rename select').select_option('educational')
        b.locator('#research-rename input').fill('promotional')
        b.once('dialog', lambda dialog: dialog.accept())
        b.locator('#research-rename button').click(); expect(b.locator('#research-status')).to_contain_text('Updated 1 posts')
        b.locator('#research-tags button', has_text='promotional').click()
        b.locator('#export-format').select_option('post')
        with b.expect_download() as download:
            b.locator('#export-csv').click()
        csv = Path(download.value.path()).read_text()
        assert 'research_notes,research_tags' in csv and 'Agreed team revision' in csv and 'promotional' in csv
        assert 'Second post' not in csv
        b.locator('#research-logout').click(); expect(b.locator('#research-team')).to_be_hidden()
        expect(b.locator('.post-card')).to_have_count(2)
        stranger.locator('#research-login input[name=email]').fill('stranger@example.test')
        stranger.locator('#research-login input[name=password]').fill('password')
        stranger.locator('#research-login button[type=submit]').click()
        expect(stranger.locator('#research-status')).to_contain_text('not been granted')
        stranger.locator('[data-post-id="archive-id-1"]').click()
        expect(stranger.locator('#research-editor')).to_have_count(0)
        b.set_viewport_size({'width': 390, 'height': 844})
        b.screenshot(path=str(ROOT / 'tests' / 'research-mobile.png'), full_page=True)
        assert not errors, errors
        browser.close()
    server.shutdown()
    print('PASS: two researchers, conflict/draft preservation, history, shared refresh, phrase tags, Hebrew, filtering, tag rename, CSV export, logout, non-member denial, mobile render')

if __name__ == '__main__':
    run()
