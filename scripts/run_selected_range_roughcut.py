#!/usr/bin/env python3
"""Fixed local finishing adapter for the Electron workbench.

The Electron main process owns every path and executable passed here. This
adapter only bridges the canonical flat beats contract into the existing
happyVideoFactory timeline builder and rough-cut renderer. It is not a generic
command runner and it never publishes output by itself.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any

MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
PAYLOAD_SCHEMA = "film_pipeline.finishing_render_payload.v1"


def _load_harness() -> tuple[Any, Any]:
    from video_core.short_drama.edit.roughcut_ffmpeg import build_roughcut
    from video_core.short_drama.edit.timeline_builder import build_timeline

    return build_timeline, build_roughcut


def _regular_absolute(path_value: str, label: str, *, executable: bool = False) -> Path:
    candidate = Path(path_value)
    if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_file():
        raise ValueError(f"{label}_invalid")
    if executable and not os.access(candidate, os.X_OK):
        raise ValueError(f"{label}_not_executable")
    return candidate.resolve(strict=True)


def _read_payload(payload_path: Path) -> dict[str, Any]:
    size = payload_path.stat().st_size
    if size <= 0 or size > MAX_PAYLOAD_BYTES:
        raise ValueError("payload_size_invalid")
    value = json.loads(payload_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {
        "schema_version", "selected_takes", "timeline_beats", "expected_order"
    }:
        raise ValueError("payload_shape_invalid")
    if value["schema_version"] != PAYLOAD_SCHEMA:
        raise ValueError("payload_schema_invalid")
    if not isinstance(value["selected_takes"], dict):
        raise ValueError("selected_takes_invalid")
    if not isinstance(value["timeline_beats"], dict):
        raise ValueError("timeline_beats_invalid")
    if not isinstance(value["expected_order"], list) or not value["expected_order"]:
        raise ValueError("expected_order_invalid")
    return value


def _render(args: argparse.Namespace) -> dict[str, Any]:
    payload_path = _regular_absolute(args.payload, "payload")
    output_path = Path(args.output)
    if not output_path.is_absolute() or output_path.name != "roughcut.mp4":
        raise ValueError("output_invalid")
    if output_path.parent.resolve(strict=True) != payload_path.parent:
        raise ValueError("output_parent_mismatch")
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("output_must_not_exist")

    ffmpeg = _regular_absolute(args.ffmpeg, "ffmpeg", executable=True)
    ffprobe = _regular_absolute(args.ffprobe, "ffprobe", executable=True)
    os.environ["HVF_FFMPEG_PATH"] = str(ffmpeg)
    os.environ["FFMPEG_PATH"] = str(ffmpeg)
    os.environ["HVF_FFPROBE_PATH"] = str(ffprobe)
    os.environ["FFPROBE_PATH"] = str(ffprobe)
    path_entries = [str(ffmpeg.parent), str(ffprobe.parent), "/usr/bin", "/bin"]
    os.environ["PATH"] = os.pathsep.join(dict.fromkeys(path_entries))

    payload = _read_payload(payload_path)
    build_timeline, build_roughcut = _load_harness()
    timeline = build_timeline(
        payload["selected_takes"],
        payload["timeline_beats"],
        audio_manifest=None,
        fps=24,
        width=1080,
        height=1920,
        measure_durations=False,
    )
    issues = timeline.validate()
    if issues:
        raise ValueError("timeline_validation_failed")

    expected_order = payload["expected_order"]
    expected_shots = [entry["shot_id"] for entry in expected_order]
    expected_beats = [entry["beat_id"] for entry in expected_order]
    if [clip.shot_id for clip in timeline.clips] != expected_shots:
        raise ValueError("timeline_shot_order_mismatch")
    if [clip.beat_id for clip in timeline.clips] != expected_beats:
        raise ValueError("timeline_beat_order_mismatch")
    if any((clip.transition_in or {}).get("type") != "cut" for clip in timeline.clips):
        raise ValueError("transition_unsupported")

    result = build_roughcut(
        timeline,
        output_path,
        transition_default="cut",
        height=1280,
        timeout=1_700,
    )
    if result.get("success") is not True:
        raise RuntimeError("roughcut_failed")
    os.chmod(output_path, 0o600)
    return {
        "success": True,
        "total_duration_seconds": timeline.total_duration,
        "shot_ids": [clip.shot_id for clip in timeline.clips],
        "beat_ids": [clip.beat_id for clip in timeline.clips],
        "ranges": [[clip.source_in, clip.source_out] for clip in timeline.clips],
    }


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--payload")
    parser.add_argument("--output")
    parser.add_argument("--ffmpeg")
    parser.add_argument("--ffprobe")
    args = parser.parse_args()
    try:
        if args.check:
            _load_harness()
            print(json.dumps({"ok": True, "adapter": PAYLOAD_SCHEMA}, separators=(",", ":")))
            return 0
        if not all((args.payload, args.output, args.ffmpeg, args.ffprobe)):
            raise ValueError("required_argument_missing")
        print(json.dumps(_render(args), separators=(",", ":"), ensure_ascii=True))
        return 0
    except Exception as error:  # fail closed without leaking paths/media content
        code = str(error).split(":", 1)[0][:96] or error.__class__.__name__
        print(json.dumps({"ok": False, "error": code}, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
