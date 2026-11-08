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
