#!/usr/bin/env python3
"""Build the deterministic, renderable source PDF used by U0 fixtures."""

from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def minimal_pdf_bytes() -> bytes:
    buffer = io.BytesIO()
    document = canvas.Canvas(
        buffer,
        pagesize=A4,
        invariant=1,
        pageCompression=0,
        pdfVersion=(1, 4),
    )
    width, height = A4
    document.setTitle("Controlled contract fixture")
    document.setAuthor("WiseLink U0 contract fixture builder")
    # Preserve the exact candidate.2 source bytes that were producer-audited before freeze.
    document.setCreator("techpub-contract-fixture-builder candidate.2")

    document.setFont("Helvetica-Bold", 18)
    document.drawString(72, height - 84, "Controlled contract fixture")
    document.setFont("Helvetica", 10)
    document.drawString(72, height - 104, "Synthetic content - no engineering authority")

    document.setLineWidth(0.8)
    document.line(72, height - 118, width - 72, height - 118)
    document.setFont("Helvetica-Bold", 13)
    document.drawString(72, height - 158, "Procedure")
    document.setFont("Helvetica", 11)
    document.drawString(72, height - 184, "Disconnect electrical power.")

    document.setFont("Helvetica-Oblique", 8)
    document.drawString(72, 54, "U0 deterministic PDF fixture")
    document.drawRightString(width - 72, 54, "Page 1 of 1")
    document.showPage()
    document.save()
    return buffer.getvalue()


def expected_outputs() -> dict[Path, bytes]:
    one_pixel_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZAAAAABJRU5ErkJggg=="
    )
    return {
        Path("fixtures/source/minimal-pdf.pdf"): minimal_pdf_bytes(),
        Path(
            "fixtures/source/native-s1000d-issue-4-2/ICN-FIXTURE-001.png"
        ): one_pixel_png,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = args.contract_root.resolve()
    mismatches = []
    for relative, expected in expected_outputs().items():
        path = root / relative
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(expected)
        elif not path.exists() or path.read_bytes() != expected:
            mismatches.append(relative.as_posix())
    report = {
        "ok": not mismatches,
        "files": [item.as_posix() for item in expected_outputs()],
        "mismatches": mismatches,
    }
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
