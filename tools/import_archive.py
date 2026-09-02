#!/usr/bin/env python3
"""Normalize Instagram posts/comments exports for the static research archive."""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen


def shortcode_from_url(url):
    match = re.search(r"instagram\.com/(?:p|reel|tv)/([^/?#]+)/?", str(url or ""))
    return match.group(1) if match else None


def integer(value):
    try: return int(value)
    except (TypeError, ValueError): return 0


def slug(value):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9._-]+", "-", str(value or "").lower()))


def pseudonym(username):
    digest = hashlib.sha256(username.lower().encode("utf-8")).hexdigest()[:8].upper()
    return f"Commenter-{digest}"


def load_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def normalize(posts, comments, title=None, collection_id=None, anonymize=False):
    comments_by_post = defaultdict(list)
    warnings = []
    for c in comments:
        code = shortcode_from_url(c.get("post_url") or c.get("url"))
        if not code:
            warnings.append(f"Skipped comment {c.get('comment_id')}: no recognizable post URL")
            continue
        username = c.get("comment_user") or "Unknown commenter"
        comments_by_post[code].append({
            "id": str(c.get("comment_id") or ""),
            "username": pseudonym(username) if anonymize else username,
            "userUrl": None if anonymize else c.get("comment_user_url"),
            "date": c.get("comment_date"),
            "text": c.get("comment") or "",
            "likes": integer(c.get("likes_number")),
            "repliesReported": integer(c.get("replies_number")),
            "parentCommentId": c.get("parent_comment_id"),
            "collectedAt": c.get("timestamp"),
        })

    username = next((p.get("user_posted") for p in posts if p.get("user_posted")), "unknown-profile")
    normalized_posts = []
    for p in posts:
        code = p.get("shortcode") or p.get("content_id") or shortcode_from_url(p.get("url"))
        if not code:
            warnings.append("Skipped a post without shortcode or recognizable URL")
            continue
        post_comments = sorted(comments_by_post.get(code, []), key=lambda c: c.get("date") or "")
        media = p.get("post_content") or [
            {"index": i, "type": "Photo", "url": url, "alt_text": p.get("alt_text")}
            for i, url in enumerate(p.get("photos") or [])
        ]
        reported = integer(p.get("num_comments"))
        normalized_posts.append({
            "id": code, "shortcode": code, "url": p.get("url"), "username": username,
            "caption": p.get("description") or "", "datePosted": p.get("date_posted"),
            "likes": integer(p.get("likes")), "commentsReported": reported,
            "commentsPreserved": len(post_comments), "commentsMissing": max(0, reported - len(post_comments)),
            "contentType": p.get("content_type") or "Unknown", "productType": p.get("product_type"),
            "thumbnailUrl": p.get("thumbnail"),
            "location": p.get("location") if isinstance(p.get("location"), list) else ([p.get("location")] if p.get("location") else []),
            "locationDetails": p.get("location_details"), "altText": p.get("alt_text") or "",
            "media": sorted([{
                "index": integer(m.get("index", i)), "type": m.get("type") or "Unknown",
                "sourceUrl": m.get("url"), "localPath": None,
                "id": str(m.get("id")) if m.get("id") is not None else None,
                "altText": m.get("alt_text") or p.get("alt_text") or ""
            } for i, m in enumerate(media)], key=lambda m: m["index"]),
            "comments": post_comments, "audio": p.get("audio"),
            "isPaidPartnership": bool(p.get("is_paid_partnership")),
            "partnershipDetails": p.get("partnership_details"), "collectedAt": p.get("timestamp")
        })
    normalized_posts.sort(key=lambda p: p.get("datePosted") or "", reverse=True)
    return {
        "id": collection_id or slug(username) or "archive",
        "title": title or f"@{username}", "username": username,
        "profileUrl": next((p.get("profile_url") for p in posts if p.get("profile_url")), None),
        "profileImageUrl": next((p.get("profile_image_link") for p in posts if p.get("profile_image_link")), None),
        "followersAtCollection": integer(next((p.get("followers") for p in posts if p.get("followers") is not None), 0)),
        "postsCountAtCollection": integer(next((p.get("posts_count") for p in posts if p.get("posts_count") is not None), 0)),
        "description": "Searchable research archive generated from supplied Instagram export data.",
        "posts": normalized_posts,
    }, warnings


def merge_collection(old, incoming):
    posts = {p["id"]: p for p in old.get("posts", [])}
    for post in incoming.get("posts", []):
        if post["id"] not in posts:
            posts[post["id"]] = post
            continue

        old_post = posts[post["id"]]
        comments = {c["id"]: c for c in old_post.get("comments", [])}
        comments.update({c["id"]: c for c in post.get("comments", [])})

        old_media = {
            str(m.get("id") or f"index:{m.get('index')}"): m
            for m in old_post.get("media", [])
        }
        merged_media = []
        for item in post.get("media", []):
            key = str(item.get("id") or f"index:{item.get('index')}")
            previous = old_media.get(key, {})
            if not item.get("localPath") and previous.get("localPath"):
                item = {**item, "localPath": previous["localPath"]}
            merged_media.append(item)

        merged = {
            **old_post,
            **post,
            "media": merged_media,
            "comments": sorted(comments.values(), key=lambda c: c.get("date") or ""),
            "commentsPreserved": len(comments),
        }
        merged["commentsMissing"] = max(
            0, integer(merged.get("commentsReported")) - len(comments)
        )
        posts[post["id"]] = merged

    return {
        **old,
        **incoming,
        "posts": sorted(
            posts.values(), key=lambda p: p.get("datePosted") or "", reverse=True
        ),
    }

def download_media(collection, media_dir):
    media_dir = Path(media_dir)
    logs = []
    for post in collection["posts"]:
        for item in post["media"]:
            url = item.get("sourceUrl")
            if not url: continue
            guessed = mimetypes.guess_extension(mimetypes.guess_type(url.split("?",1)[0])[0] or "") or Path(url.split("?",1)[0]).suffix or ".bin"
            name = f"{post['shortcode']}-{item['index']:02d}{guessed}"
            target = media_dir / collection["id"] / name
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urlopen(request, timeout=30) as response, target.open("wb") as out:
                    shutil.copyfileobj(response, out)
                item["localPath"] = f"media/{collection['id']}/{name}"
                logs.append(f"Downloaded {name}")
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                logs.append(f"WARNING: could not download {name}: {exc}")
    return logs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--posts", required=True)
    parser.add_argument("--comments", required=True)
    parser.add_argument("--output", default="docs/data/archive.json")
    parser.add_argument("--title")
    parser.add_argument("--collection-id")
    parser.add_argument("--merge", action="store_true")
    parser.add_argument("--anonymize-comments", action="store_true")
    parser.add_argument("--download-media", metavar="DIRECTORY")
    args = parser.parse_args()

    posts, comments = load_json(args.posts), load_json(args.comments)
    if not isinstance(posts, list) or not isinstance(comments, list):
        raise SystemExit("Both input files must contain top-level JSON arrays.")
    collection, warnings = normalize(posts, comments, args.title, args.collection_id, args.anonymize_comments)
    media_logs = download_media(collection, args.download_media) if args.download_media else []
    output = Path(args.output)
    archive = {"schemaVersion": "1.0", "generatedAt": datetime.now(timezone.utc).isoformat(), "notice": "This archive contains only records present in the supplied export. Reported Instagram comment counts may exceed preserved comments.", "collections": []}
    if args.merge and output.exists():
        archive = load_json(output)
    index = next((i for i, c in enumerate(archive.get("collections", [])) if c.get("id") == collection["id"]), None)
    if index is None: archive.setdefault("collections", []).append(collection)
    else: archive["collections"][index] = merge_collection(archive["collections"][index], collection)
    archive["generatedAt"] = datetime.now(timezone.utc).isoformat()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")

    reported = sum(p["commentsReported"] for p in collection["posts"])
    preserved = sum(p["commentsPreserved"] for p in collection["posts"])
    print(f"Wrote {len(collection['posts'])} posts and {preserved} comments to {output}")
    print(f"Reported comment count in posts: {reported}")
    for message in warnings + media_logs: print(message, file=sys.stderr if message.startswith("WARNING") else sys.stdout)

if __name__ == "__main__": main()
