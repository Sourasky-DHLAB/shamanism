# Shared research annotations

The archive continues to run on GitHub Pages. Research annotations live in a separate Supabase project so re-importing Instagram data does not erase notes or tags. Posts are linked by Instagram shortcode, with archive ID as a fallback for records without a shortcode.

## Activate shared storage

1. Create a Supabase project owned by the research team, or use an existing dedicated project. No paid plan is assumed by this implementation.
2. In its SQL Editor, run [`supabase/research.sql`](supabase/research.sql) once. It creates the researcher allowlist, annotations, immutable revision history, permission policies, and checked save/rename functions. The script is transactional; do not rerun it after successful installation.
3. In Authentication, create an email/password user for each researcher. Disable public signups. Give each person their own account; arrange their password directly with them rather than committing credentials. Password recovery/account administration remains in Supabase Auth for this first version.
4. Add each user's UUID and name to the team allowlist in the SQL Editor:

   ```sql
   insert into public.researchers(user_id, display_name)
   values ('REPLACE-WITH-USER-UUID', 'Researcher name');
   ```

   Creating an Auth account alone does not grant access. To revoke research access, delete the matching `researchers` row; existing revision attribution is preserved.

5. Set the project URL and **publishable key** (or legacy **anon key**) in [`docs/assets/research-config.js`](docs/assets/research-config.js). These are intended for browser use. **Never include a secret key, service-role key, database password, or researcher password.**

   ```js
   window.RESEARCH_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     publishableKey: 'YOUR-PUBLIC-PUBLISHABLE-KEY'
   };
   ```

6. Run [`supabase/research-tests.sql`](supabase/research-tests.sql) in a development project after installing the schema. Its fixtures are rolled back. It verifies permission boundaries, stale-save rejection, tag merging, history, and restoration. Then test with two actual researcher accounts against your configured site before merging the feature branch into `main`.
7. Deploy through the repository's existing GitHub Pages process. No changes to `docs/data/archive.json` are needed.

## Use the workspace

Sign in above the archive search. Open a post to edit its shared notes and tags. Type a complete phrase and press Enter or Add tag; spaces are part of the tag. Existing tags are suggested. Saving records the researcher's name, time and revision number. Tags ignore capitalization and repeated whitespace when detecting duplicates. Each post supports up to 50 tags, 120 characters per tag, and 100,000 characters of notes.

The overview counts tagged posts in the loaded archive, across collections. Click tags to filter results; choose all or any to combine them. Search also includes shared notes and tag text. Clear filters clears both research and archive filters. Rename / merge changes every assignment of a tag and records a new revision on each affected post. Removing a tag from one post is done inside that post's editor.

Annotations refresh every 30 seconds while the page is visible and when returning to the tab. Refresh annotations also fetches immediately. Refreshing never replaces an open draft. If someone else saved since you opened a post, saving is rejected. Copy any draft text you want to retain, view history, load the latest revision, reconcile the changes, then save. History shows the last 100 revisions; an earlier revision can be loaded as a draft and saved as a new revision.

Researcher annotations are **private to allowlisted signed-in users**; the original Instagram archive remains public. A session is kept in sessionStorage for the current tab, with token refresh. Closing the tab ends local session persistence. Sign out clears the annotation cache. Unsaved drafts are not stored on disk: copy them before closing or reloading the page.

## Exports and backups

Export annotations downloads all current annotations as JSON, including post keys, notes, tag arrays, revision numbers and last-editor metadata. Archive CSV exports respect tag filters and include `research_notes` and JSON-encoded `research_tags` columns in both post and comment formats. Text analysis continues to analyze source Instagram text, excluding researcher notes.

The JSON export is a current snapshot, not a revision-history backup. Back up all three research tables separately using your project's database backup/export tools. There is no browser import/restore of annotation export files in this version; historical restores within a post use revision history.

## Validation

```bash
node --test tests/research-store.test.cjs
python tests/research-browser.py
```

The browser test requires Python Playwright and installed Chromium (`python -m playwright install chromium`). It uses a mocked shared API to test two independent sessions, conflicting saves, history, filtering, tag renaming, private access, exports and rendering. It does not substitute for the SQL tests or a live two-account acceptance test. No shared backend is configured in the committed example.

Implementation references: [Supabase Auth](https://supabase.com/docs/guides/auth), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions).
