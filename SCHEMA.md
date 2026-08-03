# Accepted source schema

## Posts file

A top-level JSON array. Required for each post:

- `shortcode`, `content_id`, or a recognizable Instagram `url`
- `date_posted`

Recommended:

- `user_posted`
- `description`
- `num_comments`
- `likes`
- `content_type`
- `post_content[]` with `index`, `type`, `url`, `id`, and `alt_text`
- `timestamp`

## Comments file

A top-level JSON array. Recommended for each comment:

- `post_url` or `url`
- `comment_id`
- `comment_user`
- `comment_user_url`
- `comment_date`
- `comment`
- `likes_number`
- `replies_number`
- `timestamp`

If future exports provide `parent_comment_id`, the importer preserves it.
