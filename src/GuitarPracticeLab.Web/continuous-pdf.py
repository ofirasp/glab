#!/usr/bin/env python3
"""Build one-page reading copies while keeping the source PDFs and song metadata."""
import argparse
import json
import os
import tempfile
from pathlib import Path

import pymupdf


def convert(source):
    folder = source.parent / '.continuous'
    target = folder / source.name
    layout = target.with_suffix('.layout.json')
    # Layout is the commit marker. Rebuild if the original was replaced.
    if target.is_file() and layout.is_file() and layout.stat().st_mtime_ns >= source.stat().st_mtime_ns:
        return 'ready'

    with pymupdf.open(source) as original:
        if not original.is_pdf or original.needs_pass or not 1 <= len(original) <= 100:
            raise ValueError('Expected an unlocked PDF with 1–100 pages')
        if len(original) == 1:
            return 'already one page'

        original.bake()
        for page in original:
            if page.rotation:
                page.remove_rotation()
        sizes = [page.rect for page in original]
        width = max(rect.width for rect in sizes)
        heights = [width * rect.height / rect.width for rect in sizes]
        height = sum(heights)
        scale = min(1, 14000 / max(width, height))
        folder.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=folder) as temporary, pymupdf.open() as result:
            page = result.new_page(width=width * scale, height=height * scale)
            top = 0
            breaks = [0]
            for index, size in enumerate(heights):
                if original[index].get_contents():
                    page.show_pdf_page(pymupdf.Rect(0, top * scale, width * scale, (top + size) * scale), original, index)
                top += size
                breaks.append(top / height)
            breaks[-1] = 1
            staged = Path(temporary)
            result.save(staged / 'sheet.pdf', garbage=3, deflate=True)
            (staged / 'layout.json').write_text(json.dumps({'breaks': breaks, 'aspect': height / width}))
            os.replace(staged / 'sheet.pdf', target)
            os.replace(staged / 'layout.json', layout)
    return 'converted'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path, help='Convert a single PDF')
    args = parser.parse_args()
    lab = Path.home() / 'GuitarPracticeLab'
    library = Path(os.environ.get('GUITAR_SONG_LIBRARY', lab / 'song-library'))
    recordings = Path(os.environ.get('GUITAR_RECORDINGS_ROOT', lab / 'recordings'))
    sources = [args.file] if args.file else []
    failed = 0
    if not args.file:
        for metadata in sorted(library.glob('*/song.json')):
            try:
                name = json.loads(metadata.read_text()).get('pdfFile', 'original.pdf')
                if not isinstance(name, str) or Path(name).name != name:
                    raise ValueError('Invalid PDF filename')
                sources.append(metadata.parent / name)
            except (ValueError, OSError) as error:
                print(f'{metadata}: {error}')
                failed += 1
        sources.extend(sorted(path for path in recordings.iterdir()
                              if path.suffix.lower() == '.pdf' and not path.is_symlink()) if recordings.is_dir() else [])
    for source in sources:
        try:
            print(f'{source}: {convert(source)}', flush=True)
        except (ValueError, RuntimeError, OSError) as error:
            print(f'{source}: {error}', flush=True)
            failed += 1
    return int(failed > 0)


if __name__ == '__main__':
    raise SystemExit(main())
