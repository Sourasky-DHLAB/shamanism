"""Verify pagination, whole-archive search, deep links, and CSV export."""
import csv
import io
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
    posts = [{'id':str(i), 'shortcode':str(i), 'caption':f'Entry {i}' + (' tailMarker' if i == 55 else ''), 'datePosted':'2026-01-01', 'comments':[], 'media':[], 'commentsPreserved':0, 'commentsReported':0} for i in range(1, 56)]
    posts[0]['media'] = [{'type':'Photo','sourceUrl':'https://example.test/original.jpg','localPath':'media/the.baby.mudang/test.jpg'}]
    archive = {'collections':[{'id':'test','title':'Test','posts':posts}]}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/data/archive.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps(archive)))
        page.route('**/data/the-baby-mudang-metadata.json', lambda r: r.fulfill(content_type='application/json', body=json.dumps({'account':'the.baby.mudang','posts':[]})))
        page.route('https://d3ond2bpn3cm3y.cloudfront.net/**', lambda r: r.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'))
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        expect(page.locator('.post-card img').first).to_have_attribute('src', 'https://d3ond2bpn3cm3y.cloudfront.net/the.baby.mudang/test.jpg')
        expect(page.locator('.post-card')).to_have_count(24)
        expect(page.locator('#page-status')).to_have_text('Page 1 of 3')
        expect(page.locator('#previous-page')).to_be_disabled()
        page.locator('#next-page').click()
        expect(page.locator('#page-status')).to_have_text('Page 2 of 3')
        expect(page.locator('[data-post-id="25"]')).to_be_visible()
        expect(page.locator('[data-post-id="1"]')).to_have_count(0)
        page.locator('#next-page').click()
        expect(page.locator('.post-card')).to_have_count(7)
        expect(page.locator('#next-page')).to_be_disabled()
        page.locator('#previous-page').click()
        expect(page.locator('#page-status')).to_have_text('Page 2 of 3')
        page.locator('#query').fill('tailMarker')
        expect(page.locator('.post-card')).to_have_count(1)
        expect(page.locator('[data-post-id="55"]')).to_be_visible()
        expect(page.locator('#pagination')).to_be_hidden()
        page.locator('#query').fill('no-such-post')
        expect(page.locator('.post-card')).to_have_count(0)
        expect(page.locator('#empty-state')).to_be_visible()
        page.locator('#clear-filters').click()
        expect(page.locator('.post-card')).to_have_count(24)
        expect(page.locator('#page-status')).to_have_text('Page 1 of 3')
        page.locator('#export-format').select_option('post')
        with page.expect_download() as download:
            page.locator('#export-csv').click()
        rows = list(csv.reader(io.StringIO(Path(download.value.path()).read_text())))
        assert len(rows) == 56, 'Export must include all 55 matching posts, not just this page'
        page.evaluate("location.hash = '#post=55'")
        expect(page.locator('#post-dialog')).to_be_visible()
        expect(page.locator('#dialog-content')).to_contain_text('tailMarker')
        page.locator('#close-dialog').click()
        page.set_viewport_size({'width':390,'height':844})
        expect(page.locator('#next-page')).to_be_visible()
        assert not errors, errors
        browser.close()
    server.shutdown()
    print('PASS: page limits, navigation, last page, search, empty results, reset, full CSV export, off-page deep links, mobile')

if __name__ == '__main__':
    run()
