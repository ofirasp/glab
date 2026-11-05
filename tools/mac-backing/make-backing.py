#!/usr/bin/env python3
"""Prepare time-aligned Original / Backing MP3s locally, then copy both to the Pi."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

def run(command, env=None):
    subprocess.run([str(x) for x in command], check=True, env=env)

def audio_info(path):
    result = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'format=duration:format_tags=comment:stream=codec_name,codec_type', '-of', 'json', str(path)
    ], text=True)
    return json.loads(result)

def digest(path):
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest().upper()

def is_youtube(value):
    candidate = value.strip()
    if any(ord(c) < 32 for c in candidate):
        raise ValueError('Paste one URL or one file path only.')
    if '://' not in candidate and candidate.startswith(('youtube.com/', 'www.youtube.com/', 'youtu.be/', 'music.youtube.com/')):
        candidate = 'https://' + candidate
    parsed = urllib.parse.urlparse(candidate)
    if parsed.scheme:
        if parsed.scheme not in ('https', 'http') or parsed.hostname not in (
            'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'
        ) or parsed.username or parsed.password:
            raise ValueError('Use a YouTube URL, or an existing local MP3 file.')
        return candidate
    return None

def local_input(value):
    raw = Path(value.strip()).expanduser()
    if raw.is_file():
        source = raw
    else:
        parts = shlex.split(value.strip())
        if len(parts) != 1:
            raise ValueError('Drag one MP3 file into this window, or paste its complete path.')
        source = Path(parts[0]).expanduser()
    if not source.is_file() or source.suffix.lower() != '.mp3':
        raise ValueError('Choose an existing MP3 file.')
    return source.resolve()

def prepare_runtime(tools, env):
    override = os.environ.get('GPL_VOCAL_PYTHON')
    if override:
        # Keep the venv's executable path: resolving its symlink loses the venv.
        python = Path(override).expanduser().absolute()
        if not python.is_file():
            raise ValueError('The selected vocal-processing runtime does not exist.')
        return python
    if sys.version_info[:2] not in ((3, 11), (3, 12)):
        raise ValueError('This helper needs Python 3.11 or 3.12. On this Mac, use Python 3.12.')
    venv = tools / 'vocal-venv'
    python = venv / 'bin/python'
    marker = venv / '.guitar-backing-ready-v1'
    if not marker.exists():
        print('\nPreparing vocal-removal tools. The first run downloads several hundred MB.', flush=True)
        if not python.exists():
            run([sys.executable, '-m', 'venv', venv], env)
        run([python, '-m', 'pip', 'install', '--disable-pip-version-check',
             'numpy<2', 'torch==2.2.2', 'torchaudio==2.2.2', 'demucs==4.0.1', 'yt-dlp[default]'], env)
        marker.touch()
    elif os.environ.get('GPL_UPDATE_TOOLS') == '1':
        run([python, '-m', 'pip', 'install', '--upgrade', 'yt-dlp[default]'], env)
    return python

def download(url, python, music, env):
    folder = music / 'downloads'
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='guitar-download-') as temporary:
        manifest = Path(temporary) / 'result.txt'
        command = [python, '-m', 'yt_dlp', '--no-playlist', '--no-cache-dir', '--restrict-filenames',
                   '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
                   '--paths', folder, '--output', '%(title).80B_[%(id)s].%(ext)s',
                   '--print-to-file', 'after_move:filepath', manifest]
        node = shutil.which('node')
        fallback = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        if not node and fallback.is_file():
            node = str(fallback)
        if node:
            command += ['--js-runtimes', 'node:' + node]
        print('\nDownloading the original recording…', flush=True)
        run(command + ['--', url], env)
        path = Path(manifest.read_text().splitlines()[-1])
    if not path.is_file():
        raise ValueError('The download did not produce an MP3.')
    return path

def encode_pair(source, stem, music):
    """Retain exact original bytes and tag the backing with its source identity."""
    info = audio_info(source)
    if not any(s.get('codec_name') == 'mp3' for s in info.get('streams', [])):
        raise ValueError('The original must be a valid MP3.')
    source_hash = digest(source)
    title = re.sub(r'[^A-Za-z0-9._-]+', '_', source.stem)[:80].strip('._') or 'Song'
    base = title + '_' + source_hash[:8]
    original = music / (base + '-original.mp3')
    backing = music / (base + '-backing.mp3')
    if source.resolve() != original.resolve():
        shutil.copy2(source, original)
    # Write atomically so an interrupted encode cannot be mistaken for a finished file.
    temporary = backing.with_suffix('.encoding.mp3')
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', stem,
         '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '2',
         '-metadata', 'comment=GPL_SOURCE_SHA256=' + source_hash, temporary])
    actual = audio_info(temporary)
    duration = float(info['format']['duration'])
    if abs(float(actual['format']['duration']) - duration) > 0.25:
        raise ValueError('The generated backing has a different length. It was not sent to the Pi.')
    if actual['format'].get('tags', {}).get('comment') != 'GPL_SOURCE_SHA256=' + source_hash:
        raise ValueError('Could not preserve the timing identity tag. It was not sent to the Pi.')
    temporary.replace(backing)
    (music / (base + '-pair.json')).write_text(json.dumps({
        'original': original.name, 'backing': backing.name, 'sourceSha256': source_hash,
        'durationSeconds': duration, 'method': 'Demucs htdemucs; no trimming or time stretching'
    }, indent=2))
    return original, backing

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', help='YouTube URL or local MP3 path')
    parser.add_argument('--no-transfer', action='store_true', help='Prepare files on the Mac only')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    print('\nGuitar Practice Lab — Original + Backing → Pi', flush=True)
    value = args.input or input('Paste a YouTube URL, or drag an existing MP3 here, then press Enter:\n> ')
    if not value.strip():
        return
    url = is_youtube(value)
    source = None if url else local_input(value)
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise ValueError('FFmpeg and ffprobe are required on the Mac.')
    tools = Path(os.environ.get('GPL_TOOLS_DIR', str(Path.home() / 'Documents/Codex/GuitarPracticeLabTools')))
    music = (args.output_dir or Path.home() / 'Documents/Codex/GuitarPracticeLabAudio').expanduser().resolve()
    tools.mkdir(parents=True, exist_ok=True); music.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop('PYTHONPATH', None)
    env['TORCH_HOME'] = str(tools / 'vocal-models')
    env['OMP_NUM_THREADS'] = '4'
    if Path('/etc/ssl/cert.pem').is_file():
        env['SSL_CERT_FILE'] = env['REQUESTS_CA_BUNDLE'] = '/etc/ssl/cert.pem'
    python = prepare_runtime(tools, env)
    if url:
        source = download(url, python, music, env)
    info = audio_info(source)
    if not any(s.get('codec_name') == 'mp3' for s in info.get('streams', [])):
        raise ValueError('Choose a valid MP3 recording.')
    print('\nRemoving vocals locally. This can take several minutes; keep this window open.', flush=True)
    print('For an existing song with PDF cues, always use its exact original MP3.', flush=True)
    with tempfile.TemporaryDirectory(prefix='separation-', dir=tools) as temporary:
        run([python, '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '-d', 'cpu',
             '--shifts', '1', '--segment', '7', '--overlap', '0.25', '-j', '1', '--out', temporary, source], env)
        stem = Path(temporary) / 'htdemucs' / source.stem / 'no_vocals.wav'
        if not stem.is_file():
            raise ValueError('The separator did not produce a backing track.')
        original, backing = encode_pair(source, stem, music)
    print('\nOriginal:', original, '\nBacking:', backing, flush=True)
    if not args.no_transfer:
        target = os.environ.get('GPL_PI_TARGET', 'ofiras@glab.local')
        print('\nSending both files to the Pi. Enter its password if asked.', flush=True)
        run(['scp', '-o', 'ConnectTimeout=10', original, backing, target + ':GuitarPracticeLab/recordings/'])
        print('\nDone. On the Pi: Songs → select PDF → Tools.', flush=True)
        print('Attach the -original.mp3 with Add MP3, then attach -backing.mp3 with Add backing MP3.')
        print('For an existing song, keep its attached original and add only the matching backing.')
    else:
        print('\nBoth files are ready on the Mac. No transfer was requested.')

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped. Previously completed MP3 files are kept.', file=sys.stderr)
        sys.exit(130)
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError) as error:
        print('\nCould not finish:', error, file=sys.stderr)
        print('Any completed MP3 files remain on the Mac. No password is saved.', file=sys.stderr)
        sys.exit(1)
