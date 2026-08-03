#!/usr/bin/env python3
"""
Repair UTF-8 text that was accidentally read as Windows-1252/Latin-1
and then written back to docs/data/archive.json.

Examples:
    âœ¨ï¸  -> ✨️
    ðŸ’ª    -> 💪
    í˜œì¸ -> 혜인

The script creates archive.before-encoding-fix.json as a backup.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = REPO_ROOT / "docs" / "data" / "archive.json"
BACKUP_PATH = ARCHIVE_PATH.with_name("archive.before-encoding-fix.json")


def reconstruct_original_bytes(text: str) -> bytes:
    """
    Reverse a mixed Windows-1252/Latin-1 decoding.

    Windows PowerShell can map some bytes in the 0x80–0x9F range to CP1252
    characters and leave undefined values as C1 controls. This routine maps
    both forms back to their original single bytes.
    """
    output = bytearray()

    for character in text:
        codepoint = ord(character)

        if codepoint <= 0xFF:
            output.append(codepoint)
            continue

        encoded = character.encode("cp1252")
        if len(encoded) != 1:
            raise UnicodeEncodeError(
                "cp1252", character, 0, 1, "not a single-byte CP1252 character"
            )
        output.extend(encoded)

    return bytes(output)


def repair_text(text: str) -> str:
    try:
        repaired = reconstruct_original_bytes(text).decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text

    return repaired


def repair_value(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        repaired = repair_text(value)
        return repaired, int(repaired != value)

    if isinstance(value, list):
        repaired_list = []
        changes = 0
        for item in value:
            repaired_item, item_changes = repair_value(item)
            repaired_list.append(repaired_item)
            changes += item_changes
        return repaired_list, changes

    if isinstance(value, dict):
        repaired_dict = {}
        changes = 0
        for key, item in value.items():
            repaired_key, key_changes = repair_value(key)
            repaired_item, item_changes = repair_value(item)
            repaired_dict[repaired_key] = repaired_item
            changes += key_changes + item_changes
        return repaired_dict, changes

    return value, 0


def main() -> int:
    if not ARCHIVE_PATH.exists():
        print(f"Archive not found: {ARCHIVE_PATH}")
        return 1

    if not BACKUP_PATH.exists():
        shutil.copy2(ARCHIVE_PATH, BACKUP_PATH)
        print(f"Backup created: {BACKUP_PATH}")
    else:
        print(f"Backup already exists: {BACKUP_PATH}")

    archive = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8-sig"))
    repaired_archive, changes = repair_value(archive)

    ARCHIVE_PATH.write_text(
        json.dumps(repaired_archive, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Repaired text values: {changes}")
    print(f"Updated archive: {ARCHIVE_PATH}")

    example = "âœ¨ï¸ It's time to gather"
    print(f"Example: {example} -> {repair_text(example)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
