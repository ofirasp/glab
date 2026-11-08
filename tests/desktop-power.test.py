"""Regression test for power commands left behind across desktop restarts."""
import importlib.util
from pathlib import Path
import tempfile
import time
from unittest.mock import Mock, patch

script = Path(__file__).resolve().parents[1] / 'src/GuitarPracticeLab.Web/Desktop/desktop-session.py'
spec = importlib.util.spec_from_file_location('desktop_session', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    first = module.DesktopSession(root)
    restarted = module.DesktopSession(root)
    request = {
        'id': 'shutdown-test',
        'action': 'poweroff',
        'created': time.time(),
        'desktopSessionId': first.desktop_session_id,
    }
    with patch.object(module.subprocess, 'run', return_value=Mock(returncode=0)) as run:
        first.handle(request)
        first.handle(request)
        restarted.handle(request)
        restarted.handle({key: value for key, value in request.items() if key != 'desktopSessionId'})
        run.assert_called_once()
        restarted.handle({
            **request,
            'id': 'new-shutdown-test',
            'desktopSessionId': restarted.desktop_session_id,
        })
        assert run.call_count == 2

print('PASS shutdown runs once in its original desktop session and cannot replay after restart')

with tempfile.TemporaryDirectory() as directory:
    agent = module.DesktopSession(Path(directory))
    with patch.dict(module.os.environ, {'WAYLAND_DISPLAY': 'test-wayland'}):
        with patch.object(module.subprocess, 'Popen', return_value=Mock(poll=Mock(return_value=None))) as launch:
            agent.check_auto_idle()
            assert launch.call_args.args[0][:4] == ['swayidle', '-w', 'timeout', '600']

    with patch.object(module.subprocess, 'run') as run:
        agent.check_auto_idle()
        run.assert_not_called()
        agent.idle_marker.touch()
        run.return_value = Mock(returncode=0, stdout='Paused\nPlaying\n', stderr='')
        agent.check_auto_idle()
        run.assert_called_once()
        assert not agent.auto_screen_sleep

        agent.next_idle_check = 0
        run.return_value = Mock(returncode=0, stdout='Paused\n', stderr='')
        agent.status()
        assert '"screenShield": true' in (agent.root / 'status.json').read_text()
        assert run.call_args.args[0] == ['playerctl', '--all-players', 'status']

        def send(action):
            agent.handle({'action': action, 'id': action, 'created': time.time(),
                          'desktopSessionId': agent.desktop_session_id})

        send('screen-wake')
        agent.status()
        assert '"screenShield": false' in (agent.root / 'status.json').read_text()
        assert agent.suppress_idle_until_activity
        agent.idle_marker.unlink()
        agent.check_auto_idle()
        assert not agent.suppress_idle_until_activity

        send('screen-sleep')
        agent.status()
        assert '"screenShield": true' in (agent.root / 'status.json').read_text()
        send('screen-wake')
        agent.status()
        assert '"screenShield": false' in (agent.root / 'status.json').read_text()
        assert run.call_count == 2

print('PASS idle and manual saver state, playback suppression, and wake without display power commands')
