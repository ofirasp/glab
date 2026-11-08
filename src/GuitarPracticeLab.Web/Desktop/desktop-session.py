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
    desktop_result = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.desktop_session_id = str(uuid4())
        self.auto_idle_started = False
        self.saver_style = 'black'
        self.idle_minutes = 10
        self.next_settings_check = 0.0
        self.auto_idle_process = None
        self.idle_marker = self.root / 'desktop-idle'
        self.auto_screen_sleep = False
        self.manual_screen_sleep = False
        self.suppress_idle_until_activity = False
        self.next_idle_check = 0.0

    def handle(self, command):
        action = command.get('action')
        if action not in ('poweroff', 'screen-sleep', 'screen-wake'):
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
            elif action == 'screen-sleep':
                self.manual_screen_sleep = True
            else:
                self.manual_screen_sleep = False
                self.auto_screen_sleep = False
                self.suppress_idle_until_activity = self.idle_marker.exists()
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            error = str(exc)[:200]
        self.desktop_result = {'id': command_id, 'error': error}

    def start_auto_idle(self):
        self.idle_marker.unlink(missing_ok=True)
        if os.environ.get('WAYLAND_DISPLAY'):
            env = {**os.environ, 'GPL_IDLE_MARKER': str(self.idle_marker)}
            self.auto_idle_process = subprocess.Popen([
                'swayidle', '-w', 'timeout', str(self.idle_minutes * 60), 'touch "$GPL_IDLE_MARKER"',
                'resume', 'rm -f "$GPL_IDLE_MARKER"'
            ], env=env)

    def refresh_saver_settings(self):
        now = time.monotonic()
        if now < self.next_settings_check:
            return
        self.next_settings_check = now + 1
        try:
            settings = json.loads((self.root / 'screen-settings.json').read_text())
        except (OSError, ValueError):
            return
        if not isinstance(settings, dict):
            return
        style = settings.get('style')
        if style in ('black', 'clock', 'guitar'):
            self.saver_style = style
        minutes = settings.get('idleMinutes')
        if type(minutes) is not int or minutes not in (1, 5, 10, 15, 30, 60) or minutes == self.idle_minutes:
            return
        self.idle_minutes = minutes
        self.auto_screen_sleep = False
        if self.auto_idle_process and self.auto_idle_process.poll() is None:
            self.auto_idle_process.terminate()
            try:
                self.auto_idle_process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.auto_idle_process.kill()
                self.auto_idle_process.wait()
        self.auto_idle_process = None
        self.auto_idle_started = False

    def check_auto_idle(self):
        self.refresh_saver_settings()
        if not self.auto_idle_started:
            self.auto_idle_started = True
            self.start_auto_idle()
        if self.auto_idle_process and self.auto_idle_process.poll() is not None:
            self.idle_marker.unlink(missing_ok=True)
            self.auto_idle_process = None
        if not self.idle_marker.exists():
            self.auto_screen_sleep = False
            self.suppress_idle_until_activity = False
            return
        now = time.monotonic()
        if self.auto_screen_sleep or self.manual_screen_sleep or self.suppress_idle_until_activity or now < self.next_idle_check:
            return
        self.next_idle_check = now + 3
        # Chromium publishes playback via MPRIS. This also catches playing
        # background tabs where the page cannot hold a screen wake lock.
        result = subprocess.run(
            ['playerctl', '--all-players', 'status'],
            capture_output=True, text=True, timeout=2, env={**os.environ, 'LC_ALL': 'C'}
        )
        if (result.returncode and 'No players found' not in result.stderr
                or 'Playing' in result.stdout.splitlines() or not self.idle_marker.exists()):
            return
        self.auto_screen_sleep = True

    def status(self):
        try:
            self.check_auto_idle()
        except (OSError, subprocess.SubprocessError) as exc:
            logging.warning('Automatic screen blanking: %s', exc)
        target = self.root / 'status.json'
        temporary = self.root / 'status.tmp'
        temporary.write_text(json.dumps({
            'heartbeat': time.time(), 'available': bool(self.executable),
            'running': self.running(), 'error': self.error, 'captureId': self.extension_id,
            'desktopControls': True, 'desktopSessionId': self.desktop_session_id,
            'desktopResult': self.desktop_result,
            'screenStyle': self.saver_style,
            'screenShield': self.manual_screen_sleep or self.auto_screen_sleep,
        }))
        temporary.replace(target)

    def run(self):
        try:
            super().run()
        finally:
            if self.auto_idle_process and self.auto_idle_process.poll() is None:
                self.auto_idle_process.terminate()


if __name__ == '__main__':
    DesktopSession().run()
