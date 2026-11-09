"""Browser regression for comment record boundaries in the analysis page."""
import json
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

def run():
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root / 'docs')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    post = {'id':'test-post', 'username':'publisher', 'caption': ' '.join(['mudang'] * 10) + ' caption boundary', 'datePosted':'2026-01-01', 'contentType':'Image', 'commentsPreserved':4, 'media':[], 'comments':[
        {'id':str(i), 'username':f'author{i}', 'date':'2026-02-01', 'text':text}
        for i, text in enumerate(['beautiful','beautiful','beautiful','oh wow you have been here ' + ' '.join(['mudang'] * 5)], 1)
    ]}
    archive = {'collections':[{'id':'test','title':'Test','posts':[post]}]}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/data/archive.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(archive)))
        page.goto(f'http://127.0.0.1:{server.server_port}/analysis.html')
        expect(page.locator('#summary')).to_contain_text('Text records')
        row = page.locator('#frequency-output tbody tr').filter(has=page.get_by_role('cell', name='mudang', exact=True))
        expect(row.locator('td')).to_have_text(['mudang', '15', '2'])
        page.locator('#source-mode').select_option('comments')
        expect(row.locator('td')).to_have_text(['mudang', '5', '1'])
        page.locator('#kwic-term').fill('beautiful')
        page.locator('#run-btn').click()
        page.locator('[data-panel=kwic]').click()
        expect(page.locator('.kwic-item')).to_have_count(3)
        for line in page.locator('.kwic-line').all():
            expect(line).to_have_text('beautiful')
        expect(page.locator('.kwic-item').first).to_contain_text('author1')
        expect(page.locator('.kwic-item a').first).to_have_attribute('href','index.html#post=test-post')
        page.locator('[data-panel=ngrams]').click()
        expect(page.locator('#ngrams-output')).not_to_contain_text('beautiful oh')
        expect(page.locator('#ngrams-output')).not_to_contain_text('beautiful beautiful')
        expect(page.locator('#ngrams-output')).to_contain_text('oh wow')
        page.locator('[data-panel=collocation]').click()
        expect(page.locator('#collocation-output')).not_to_contain_text('beautiful')
        assert not errors, errors
        browser.close()
    server.shutdown()
    print('PASS: analysis KWIC attribution and record boundaries in browser')

if __name__ == '__main__':
    run()
