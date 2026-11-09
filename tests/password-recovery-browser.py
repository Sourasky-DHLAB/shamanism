"""Mocked password recovery UI tests. Never sends email or changes real accounts."""
import json
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

def run():
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root / 'docs')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    requests = []
    expired = False
    def api(route):
        cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type,authorization','Access-Control-Allow-Methods':'GET,PUT,POST,OPTIONS'}
        if route.request.method == 'OPTIONS':
            route.fulfill(status=204, headers=cors); return
        requests.append({'url':route.request.url,'method':route.request.method,'headers':route.request.headers,'body':route.request.post_data_json})
        path = urlparse(route.request.url).path
        status, data = 200, {}
        if path == '/auth/v1/user':
            assert route.request.headers.get('authorization') == 'Bearer recovery-test-token'
            if expired:
                status, data = 401, {'message':'Reset session expired. Request a new link.'}
            else:
                data = {'id':'researcher-id'}
        route.fulfill(status=status, content_type='application/json', headers=cors, body=json.dumps(data))
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/research-config.js', lambda r: r.fulfill(content_type='application/javascript', body="window.RESEARCH_CONFIG={supabaseUrl:'https://test.supabase.co',publishableKey:'public-test'}"))
        page.route('https://test.supabase.co/**', api)
        page.route('**/data/archive.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps({'collections':[]})))
        page.route('**/data/the-baby-mudang-metadata.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps({'account':'the.baby.mudang','posts':[]})))
        page.goto(origin + '/index.html')
        page.get_by_role('button', name='Forgot password?').click()
        page.locator('#research-recovery input[name=email]').fill('researcher@example.test')
        page.get_by_role('button', name='Send reset link').click()
        expect(page.locator('#research-status')).to_contain_text('If this email belongs to an account')
        sent = requests[-1]
        assert sent['body']['email'] == 'researcher@example.test'
        assert parse_qs(urlparse(sent['url']).query)['redirect_to'] == [origin + '/reset-password.html']
        assert 'authorization' not in sent['headers']
        page.get_by_role('button', name='Back to sign in').click()
        expect(page.locator('#research-login')).to_be_visible()
        page.goto(origin + '/reset-password.html')
        expect(page.locator('#reset-password-form')).to_be_hidden()
        expect(page.locator('#reset-status')).to_contain_text('Open this page using')
        page.goto(origin + '/reset-password.html#access_token=recovery-test-token&type=recovery')
        expect(page.locator('#reset-password-form')).to_be_visible()
        assert '#' not in page.url, 'Credential fragment must be removed from URL'
        assert page.evaluate('sessionStorage.length') == 0
        page.locator('#new-password').fill('new-test-password')
        page.locator('#confirm-password').fill('mismatched-password')
        page.get_by_role('button', name='Save new password').click()
        expect(page.locator('#reset-status')).to_contain_text('do not match')
        assert not any(r['method'] == 'PUT' for r in requests)
        page.locator('#confirm-password').fill('new-test-password')
        page.get_by_role('button', name='Save new password').click()
        expect(page.locator('#reset-status')).to_contain_text('Your password has been changed')
        expect(page.locator('#reset-password-form')).to_be_hidden()
        updated = next(r for r in requests if r['method'] == 'PUT')
        assert updated['body'] == {'password':'new-test-password'}
        assert requests[-1]['url'].endswith('/auth/v1/logout')
        expired = True
        page.goto(origin + '/reset-password.html#access_token=recovery-test-token&type=recovery')
        expect(page.locator('#reset-password-form')).to_be_hidden()
        expect(page.locator('#reset-status')).to_contain_text('expired')
        assert not errors, errors
        browser.close()
    server.shutdown()
    print('PASS: request email link, reset callback, missing/expired link, mismatch, password update, logout, token cleanup')

if __name__ == '__main__':
    run()
