#!/usr/bin/env python3
"""
Convert HEIC/HEIF files under docs/media to browser-compatible JPEG files
and update docs/data/archive.json to point to the converted copies.

Run from anywhere inside the repository:
    py tools\convert_heic_media.py
or:
    python tools\convert_heic_media.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image
    from pillow_heif import register_heif_opener
except ImportError:
    print(
        "Missing packages.\n"
        "Install them with:\n"
        "  py -m pip install --user pillow pillow-heif\n"
        "or:\n"
        "  python -m pip install --user pillow pillow-heif",
        file=sys.stderr,
    )
    raise SystemExit(1)

register_heif_opener()

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
MEDIA_ROOT = DOCS_ROOT / "media"
ARCHIVE_PATH = DOCS_ROOT / "data" / "archive.json"


def relative_to_docs(path: Path) -> str:
    return path.relative_to(DOCS_ROOT).as_posix()


def convert_heic_files() -> tuple[dict[str, str], list[tuple[str, str]]]:
    converted: dict[str, str] = {}
    failures: list[tuple[str, str]] = []

    files = sorted(
        p for p in MEDIA_ROOT.rglob("*")
        if p.is_file() and p.suffix.lower() in {".heic", ".heif"}
    )

    if not files:
        print(f"No HEIC/HEIF files found under {MEDIA_ROOT}")
        return converted, failures

    for source in files:
        target = source.with_suffix(".jpg")
        source_relative = relative_to_docs(source)
        target_relative = relative_to_docs(target)

        try:
            with Image.open(source) as image:
                # JPEG does not support alpha channels.
                if image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                image.save(target, format="JPEG", quality=92, optimize=True)

            converted[source_relative] = target_relative
            print(f"Converted: {source_relative} -> {target_relative}")
        except Exception as exc:
            failures.append((source_relative, str(exc)))
            print(f"FAILED: {source_relative}: {exc}", file=sys.stderr)

    return converted, failures


def update_archive(converted: dict[str, str]) -> int:
    if not ARCHIVE_PATH.exists():
        raise FileNotFoundError(f"Archive not found: {ARCHIVE_PATH}")

    data = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8-sig"))
    updated = 0

    for collection in data.get("collections", []):
        for post in collection.get("posts", []):
            for media in post.get("media", []):
                local_path = media.get("localPath")
                if not local_path:
                    continue

                # Exact HEIC path found and converted.
                if local_path in converted:
                    media["localPath"] = converted[local_path]
                    updated += 1
                    continue

                # The archive may already have been changed from .heic to .jpg.
                # Keep it if the corresponding converted JPEG now exists.
                local = Path(local_path)
                if local.suffix.lower() == ".jpg":
                    candidate = DOCS_ROOT / local
                    if candidate.exists():
                        continue

                # If archive says .jpg but only the HEIC source existed before,
                # the conversion above has now created the matching JPEG.
                if local.suffix.lower() == ".jpg":
                    heic_variant = local.with_suffix(".heic").as_posix()
                    if heic_variant in converted:
                        media["localPath"] = converted[heic_variant]
                        updated += 1

    ARCHIVE_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return updated


def audit_missing_media() -> list[str]:
    data = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8-sig"))
    missing: list[str] = []

    for collection in data.get("collections", []):
        for post in collection.get("posts", []):
            for media in post.get("media", []):
                local_path = media.get("localPath")
                if local_path and not (DOCS_ROOT / local_path).exists():
                    missing.append(local_path)

    return sorted(set(missing))


def main() -> int:
    if not MEDIA_ROOT.exists():
        print(f"Media folder not found: {MEDIA_ROOT}", file=sys.stderr)
        return 1

    converted, failures = convert_heic_files()
    updated = update_archive(converted)
    missing = audit_missing_media()

    print()
    print(f"HEIC/HEIF files converted: {len(converted)}")
    print(f"Archive media paths updated: {updated}")
    print(f"Conversion failures: {len(failures)}")
    print(f"Archive paths still missing locally: {len(missing)}")

    if missing:
        print("\nMissing local media paths:")
        for path in missing:
            print(f"  {path}")

    print(
        "\nThe original HEIC files were retained as backups. "
        "Delete them only after the published site has been checked."
    )

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
