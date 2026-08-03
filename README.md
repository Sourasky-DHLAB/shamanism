# Instagram Research Archive

A reusable, static, searchable archive designed for GitHub Pages. It accepts the two JSON formats supplied for this project:

- a posts array (`posts.json`)
- a comments array (`comments.json`)

The included sample contains four posts and four separately attributed comments.

## Features

- Browser search across captions, comments, usernames, locations, and alt text
- Filters by collection, content type, date, and comment availability
- Deep links to individual post views using URL hashes
- Carousel and video-aware media display
- Reported-versus-preserved comment counts
- Multi-profile collections
- Local browser importer with optional commenter pseudonymization
- Python importer with optional media download
- GitHub Actions deployment workflow

## Preview locally

GitHub Pages sites should be viewed through a web server rather than by double-clicking `index.html`.

```bash
cd docs
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Add another archive in the browser

1. Open `docs/importer.html` through the local server.
2. Select the new `posts.json` and `comments.json`.
3. Optionally select the existing `docs/data/archive.json` to merge with it.
4. Validate and download the generated `archive.json`.
5. Replace `docs/data/archive.json` with the downloaded file.
6. Commit and push.

The browser importer does not send data anywhere. It cannot permanently download Instagram media because browser cross-origin rules and expiring CDN URLs make that unreliable.

## Add another archive with Python

```bash
python tools/import_archive.py \
  --posts path/to/posts.json \
  --comments path/to/comments.json \
  --output docs/data/archive.json \
  --merge
```

Optional stable commenter pseudonyms:

```bash
python tools/import_archive.py \
  --posts path/to/posts.json \
  --comments path/to/comments.json \
  --output docs/data/archive.json \
  --merge \
  --anonymize-comments
```

Attempt to preserve media locally:

```bash
python tools/import_archive.py \
  --posts path/to/posts.json \
  --comments path/to/comments.json \
  --output docs/data/archive.json \
  --merge \
  --download-media docs/media
```

Instagram CDN links can expire or reject automated downloads. Check the command output and verify every media item before publication.

## Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload the contents of this project.
3. Ensure the default branch is named `main`.
4. In **Settings → Pages**, choose **GitHub Actions** as the source.
5. Push a commit. The included workflow deploys the `docs` directory.

The public URL will normally be:

```text
https://YOUR-USERNAME.github.io/REPOSITORY-NAME/
```

## Data completeness

The posts export may report more comments than the comments export actually preserves. The interface deliberately displays both figures. It does not describe absent comments as archived.

## Privacy

The importer can replace commenter usernames with stable pseudonyms. Review consent, copyright, institutional ethics requirements, and data-protection obligations before publishing third-party comments or profile links.
