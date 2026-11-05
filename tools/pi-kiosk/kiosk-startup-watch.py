#!/usr/bin/env python3
"""Recover blank/unloaded startup documents without changing a working session."""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import time
import urllib.request
from urllib.parse import urlsplit


def exact(sock, size):
    result = b''
    while len(result) < size:
        part = sock.recv(size - len(result))
        if not part:
            raise OSError('Browser disconnected')
        result += part
    return result


def command(url, method, params):
    address = urlsplit(url)
    if address.hostname not in ('localhost', '127.0.0.1'):
        raise ValueError('Only local browser connections are allowed')
    with socket.create_connection((address.hostname, address.port), timeout=4) as sock:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f'GET {address.path} HTTP/1.1\r\nHost: {address.netloc}\r\n'
                      'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                      f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += exact(sock, 1)
            if len(header) > 16384:
                raise OSError('Invalid browser handshake')
        expected = base64.b64encode(hashlib.sha1(
            (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if b' 101 ' not in header.split(b'\r\n')[0] or expected not in header:
            raise OSError('Browser handshake failed')
        payload = json.dumps({'id': 1, 'method': method, 'params': params}).encode()
        mask = os.urandom(4)
        size = len(payload)
        length = bytes([0x80 | size]) if size < 126 else bytes([0xfe]) + struct.pack('!H', size)
        sock.sendall(b'\x81' + length + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(payload)))
        fragments = b''
        while True:
            first, second = exact(sock, 2)
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', exact(sock, 2))[0]
            elif size == 127:
                size = struct.unpack('!Q', exact(sock, 8))[0]
            if size > 2_000_000:
                raise OSError('Browser response too large')
            mask = exact(sock, 4) if second & 128 else None
            data = exact(sock, size)
            if mask:
                data = bytes(v ^ mask[i % 4] for i, v in enumerate(data))
            opcode = first & 15
            if opcode == 8:
                raise OSError('Browser closed connection')
            if opcode not in (0, 1):
                continue
            fragments += data
            if first & 128:
                message = json.loads(fragments)
                fragments = b''
                if message.get('id') == 1:
                    if 'error' in message:
                        raise OSError(str(message['error']))
                    return message['result']


READY = """(() => {
  if (location.origin !== 'http://127.0.0.1:5080') return false;
  let d = document;
  const f = d.querySelector('iframe[title="Guitar Practice Lab"]');
  if (f) { try { d = f.contentDocument; } catch { return false; } }
  return !!(d && d.readyState === 'complete' && d.body &&
    d.body.innerText.trim().length > 30);
})()"""


def watch(profile, pid):
    # Watch only startup. Never reload a practice session after it has loaded.
    time.sleep(12)
    failures = 0
    attempts = 0
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(18):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        try:
            port = int((profile / 'DevToolsActivePort').read_text().splitlines()[0])
            with opener.open(f'http://127.0.0.1:{port}/json/list', timeout=4) as response:
                pages = json.load(response)
            page = next(p for p in pages if p.get('type') == 'page' and
                        (p.get('url', '').startswith('http://127.0.0.1:5080/') or
                         p.get('url') in ('about:blank', 'chrome-error://chromewebdata/')))
            ws = page['webSocketDebuggerUrl']
            result = command(ws, 'Runtime.evaluate', {'expression': READY, 'returnByValue': True})
            if result.get('result', {}).get('value') is True:
                print('Kiosk page loaded; startup recovery finished.', flush=True)
                return
            failures += 1
            if failures >= 3 and attempts < 2:
                print('Startup page did not load; retrying automatically.', flush=True)
                command(ws, 'Page.navigate', {'url': 'http://127.0.0.1:5080/'})
                failures = 0
                attempts += 1
        except (OSError, ValueError, KeyError, StopIteration) as error:
            print(f'Startup check waiting: {error}', flush=True)
        time.sleep(5)
    print('Startup recovery timed out. See kiosk-startup.log.', flush=True)


if __name__ == '__main__':
    watch(Path(sys.argv[1]), int(sys.argv[2]))
