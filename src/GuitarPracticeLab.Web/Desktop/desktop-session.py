#!/usr/bin/env python3
"""Run lesson browsing and the kiosk's power controls in the desktop session."""
import importlib.util
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import time
from uuid import uuid4

spec = importlib.util.spec_from_file_location(
    'lesson_browser', Path(__file__).with_name('lesson-browser.py')
)
lesson_browser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lesson_browser)


class DesktopSession(lesson_browser.Browser):
    screen_idle = None
    desktop_result = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.desktop_session_id = str(uuid4())
        self.auto_idle_started = False
        self.auto_idle_process = None
        self.idle_marker = self.root / 'desktop-idle'
        self.auto_blanked = False
        self.next_idle_check = 0.0

    def handle(self, command):
        action = command.get('action')
        if action not in ('poweroff', 'screen-sleep'):
            return super().handle(command)
        command_id = command.get('id')
        if command.get('desktopSessionId') != self.desktop_session_id:
            return
        if command_id == self.seen or abs(time.time() - command.get('created', 0)) > 30:
            return
        self.seen = command_id
        error = ''
        try:
            if action == 'poweroff':
                result = subprocess.run(
                    ['systemctl', '--no-ask-password', 'poweroff'],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode:
                    raise RuntimeError(result.stderr.strip() or 'The desktop denied shutdown.')
            else:
                self.sleep_screen()
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            error = str(exc)[:200]
        self.desktop_result = {'id': command_id, 'error': error}

    def sleep_screen(self):
        if os.environ.get('WAYLAND_DISPLAY'):
            if self.auto_blanked or (self.screen_idle and self.screen_idle.poll() is None):
                return
            if not shutil.which('swayidle') or not shutil.which('wlopm'):
                raise RuntimeError('Screen sleep requires swayidle and wlopm on this desktop.')
            self.wake_marker = self.root / 'screen-woke'
            self.wake_marker.unlink(missing_ok=True)
            # swayidle runs the same output power commands as Pi OS screen blanking.
            # The resume handler wakes the display and marks this one-shot request done.
            env = {**os.environ, 'GPL_WAKE_MARKER': str(self.wake_marker)}
            self.screen_idle = subprocess.Popen([
                'swayidle', '-w', 'timeout', '2',
                """if [ ! -e "$GPL_WAKE_MARKER" ]; then wlopm --off '*'; fi""",
                'resume', """touch "$GPL_WAKE_MARKER"; wlopm --on '*'"""
            ], env=env)
            time.sleep(.2)
            if self.screen_idle.poll() is not None:
                raise RuntimeError('Could not start screen blanking in this Wayland session.')
            return
        if not os.environ.get('DISPLAY'):
            raise RuntimeError('The Pi desktop display is unavailable.')
        if shutil.which('xscreensaver-command'):
            result = subprocess.run(['xscreensaver-command', '-activate'], timeout=5)
            if result.returncode == 0:
                return
        subprocess.run(['xset', 's', 'activate'], check=True, timeout=5)

    def start_auto_idle(self):
        self.idle_marker.unlink(missing_ok=True)
        if os.environ.get('WAYLAND_DISPLAY'):
            env = {**os.environ, 'GPL_IDLE_MARKER': str(self.idle_marker)}
            self.auto_idle_process = subprocess.Popen([
                'swayidle', '-w', 'timeout', '600', 'touch "$GPL_IDLE_MARKER"',
                'resume', 'rm -f "$GPL_IDLE_MARKER"'
            ], env=env)
        elif os.environ.get('DISPLAY'):
            subprocess.run(['xset', 's', '600'], check=True, timeout=3)

    def check_auto_idle(self):
        if not self.auto_idle_started:
            self.auto_idle_started = True
            self.start_auto_idle()
        if self.auto_idle_process and self.auto_idle_process.poll() is not None:
            self.idle_marker.unlink(missing_ok=True)
            self.auto_idle_process = None
        if not self.idle_marker.exists():
            if self.auto_blanked:
                subprocess.run(['wlopm', '--on', '*'], check=True, timeout=3)
                self.auto_blanked = False
            return
        now = time.monotonic()
        if self.auto_blanked or self.screen_idle or now < self.next_idle_check:
            return
        self.next_idle_check = now + 3
        # Chromium publishes playback via MPRIS. This also catches playing
        # background tabs where the page cannot hold a screen wake lock.
        result = subprocess.run(
            ['playerctl', '--all-players', 'status'],
            capture_output=True, text=True, timeout=2, env={**os.environ, 'LC_ALL': 'C'}
        )
        if result.returncode and 'No players found' not in result.stderr:
            return
        if 'Playing' in result.stdout.splitlines() or not self.idle_marker.exists():
            return
        subprocess.run(['wlopm', '--off', '*'], check=True, timeout=3)
        self.auto_blanked = True

    def status(self):
        try:
            self.check_auto_idle()
        except (OSError, subprocess.SubprocessError) as exc:
            logging.warning('Automatic screen blanking: %s', exc)
        if self.screen_idle and (self.screen_idle.poll() is not None or self.wake_marker.exists()):
            if self.screen_idle.poll() is None:
                self.screen_idle.terminate()
                try:
                    self.screen_idle.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.screen_idle.kill()
                    self.screen_idle.wait()
            self.wake_marker.unlink(missing_ok=True)
            self.screen_idle = None
        target = self.root / 'status.json'
        temporary = self.root / 'status.tmp'
        temporary.write_text(json.dumps({
            'heartbeat': time.time(), 'available': bool(self.executable),
            'running': self.running(), 'error': self.error, 'captureId': self.extension_id,
            'desktopControls': True, 'desktopSessionId': self.desktop_session_id,
            'desktopResult': self.desktop_result,
        }))
        temporary.replace(target)

    def run(self):
        try:
            super().run()
        finally:
            for process in (self.screen_idle, self.auto_idle_process):
                if process and process.poll() is None:
                    process.terminate()
            if self.auto_blanked:
                subprocess.run(['wlopm', '--on', '*'], check=False, timeout=3)


if __name__ == '__main__':
    DesktopSession().run()
