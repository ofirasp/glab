#!/usr/bin/env python3
"""Prepare a resumable URL list, sending each Original/Backing pair to the Pi."""
import argparse
from datetime import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlparse

spec = importlib.util.spec_from_file_location('backing_helper', Path(__file__).with_name('make-backing.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def read_urls(path):
    entries = []
    seen = set()
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        url = helper.is_youtube(line)
        if not url:
            raise ValueError('The URL list must contain one YouTube URL per line.')
        parsed = urlparse(url)
        video = parsed.path.strip('/') if parsed.hostname in ('youtu.be', 'www.youtu.be') else parse_qs(parsed.query).get('v', [''])[0]
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
            raise ValueError('Use an individual video URL: ' + line)
        if video not in seen:
            entries.append((video, url))
            seen.add(video)
    if not entries:
        raise ValueError('No URLs found in ' + str(path))
    return entries


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.replace(path)


def ready_pair(folder, state):
    if not isinstance(state, dict):
        return None
    try:
        paths = [folder / state[key] for key in ('original', 'backing')]
        if any(p.parent != folder or not p.is_file() for p in paths):
            return None
        original, backing = paths
        sha = helper.digest(original)
        first, second = helper.audio_info(original), helper.audio_info(backing)
        for info in (first, second):
            if not any(s.get('codec_name') == 'mp3' for s in info.get('streams', [])):
                return None
        if sha != state['sourceSha256'] or second['format'].get('tags', {}).get('comment') != 'GPL_SOURCE_SHA256=' + sha:
            return None
        if abs(float(first['format']['duration']) - float(second['format']['duration'])) > .25:
            return None
        return original, backing
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        return None


def make_pair(video, url, output, tools, python, env):
    state_path = output / (video + '.json')
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    pair = ready_pair(output, state)
    if pair:
        print('Reusing completed original and backing.', flush=True)
        return pair
    source = None
    # Preserve the exact downloaded original across interrupted separations.
    name = state.get('download')
    if name and Path(name).name == name:
        candidate = output / 'downloads' / name
        if candidate.is_file() and helper.digest(candidate) == state.get('downloadSha256'):
            source = candidate
    if source is None:
        source = helper.download(url, python, output, env)
        state = {'url': url, 'download': source.name, 'downloadSha256': helper.digest(source)}
        write_json(state_path, state)
    print('Removing vocals on the Mac. This may take several minutes.', flush=True)
    with tempfile.TemporaryDirectory(prefix='url-separation-', dir=tools) as temporary:
        helper.run([python, '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '-d', 'cpu',
                    '--shifts', '1', '--segment', '7', '--overlap', '0.25', '-j', '1', '--out', temporary, source], env)
        stem = Path(temporary) / 'htdemucs' / source.stem / 'no_vocals.wav'
        if not stem.is_file():
            raise ValueError('The separator did not produce a backing track.')
        original, backing = helper.encode_pair(source, stem, output)
    state.update(original=original.name, backing=backing.name, sourceSha256=helper.digest(original))
    write_json(state_path, state)
    return original, backing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--urls', type=Path, default=Path(__file__).with_name('urls.txt'))
    parser.add_argument('--output-dir', type=Path, default=Path.home() / 'Documents/Codex/GuitarPracticeLabAudio/YouTubeBatch')
    parser.add_argument('--no-transfer', action='store_true')
    args = parser.parse_args()
    entries = read_urls(args.urls)
    for program in ['ffmpeg', 'ffprobe'] + ([] if args.no_transfer else ['ssh', 'scp']):
        if not shutil.which(program):
            raise ValueError(program + ' is required on the Mac.')
    output = args.output_dir.expanduser().resolve()
    tools = Path(os.environ.get('GPL_TOOLS_DIR', str(Path.home() / 'Documents/Codex/GuitarPracticeLabTools'))).expanduser().absolute()
    output.mkdir(parents=True, exist_ok=True)
    tools.mkdir(parents=True, exist_ok=True)
    lock = (output / '.batch.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ValueError('This batch is already running. Keep its existing window open.')
    env = os.environ.copy()
    env.pop('PYTHONPATH', None)
    env['TORCH_HOME'] = str(tools / 'vocal-models')
    env['OMP_NUM_THREADS'] = '4'
    if Path('/etc/ssl/cert.pem').is_file():
        env['SSL_CERT_FILE'] = env['REQUESTS_CA_BUNDLE'] = '/etc/ssl/cert.pem'
    target = os.environ.get('GPL_PI_TARGET', 'ofiras@glab.local')
    report = {'started': datetime.now().isoformat(), 'total': len(entries), 'completed': [], 'failed': []}
    print(f'\nGuitar Practice Lab — {len(entries)} URL backing tracks', flush=True)
    print('Keep this window open and the Mac lid open. Completed tracks are reused on reruns.', flush=True)
    with tempfile.TemporaryDirectory(prefix='gpl-url-ssh-', dir='/tmp') as temporary:
        socket = str(Path(temporary) / 'ssh')
        options = ['-o', 'ControlMaster=auto', '-o', 'ControlPersist=7200', '-o', 'ControlPath=' + socket,
                   '-o', 'ServerAliveInterval=30', '-o', 'ConnectTimeout=10']
        connected = False
        try:
            if not args.no_transfer:
                print('\nConnecting to the Pi. Enter its normal SSH password if asked.', flush=True)
                helper.run(['ssh', *options, target, 'mkdir -p "$HOME/GuitarPracticeLab/recordings"'])
                connected = True
            python = None
            for index, (video, url) in enumerate(entries, 1):
                print(f'\n[{index}/{len(entries)}] {url}', flush=True)
                try:
                    state_path = output / (video + '.json')
                    try:
                        cached = ready_pair(output, json.loads(state_path.read_text()))
                    except (OSError, ValueError):
                        cached = None
                    if cached:
                        pair = cached
                        print('Reusing completed original and backing.', flush=True)
                    else:
                        if python is None:
                            python = helper.prepare_runtime(tools, env)
                        pair = make_pair(video, url, output, tools, python, env)
                    if not args.no_transfer:
                        helper.run(['scp', *options, *pair, target + ':GuitarPracticeLab/recordings/'])
                    report['completed'].append({'url': url, 'original': pair[0].name, 'backing': pair[1].name,
                                                'sentToPi': not args.no_transfer})
                    print('Ready' + (' and sent to Pi.' if not args.no_transfer else ' on Mac.'), flush=True)
                except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
                    report['failed'].append({'url': url, 'error': str(error)})
                    print('Failed:', error, '\nContinuing with the next URL.', flush=True)
                finally:
                    write_json(output / 'last-url-batch-report.json', report)
        finally:
            if connected:
                subprocess.run(['ssh', '-S', socket, '-O', 'exit', target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            write_json(output / 'last-url-batch-report.json', report)
    print(f"\nFinished: {len(report['completed'])} ready; {len(report['failed'])} failed.", flush=True)
    print('Files and report:', output, flush=True)
    if report['failed']:
        raise ValueError('Rerun to retry failed URLs. Completed pairs are reused.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped. Completed tracks are kept. Run again to continue.', file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('\nCould not finish:', error, file=sys.stderr)
        sys.exit(1)
