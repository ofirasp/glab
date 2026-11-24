#!/usr/bin/env python3
"""SSH password reply via a private, short-lived socket. No password on disk."""
import json,os,socket,sys
try:
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
  connection.connect(os.environ['GPL_ASKPASS_SOCKET'])
  connection.sendall(json.dumps({'token':os.environ['GPL_ASKPASS_TOKEN'],'prompt':' '.join(sys.argv[1:])}).encode()+b'\n')
  data=b''
  while b'\n' not in data:
   chunk=connection.recv(4096)
   if not chunk:break
   data+=chunk
  reply=json.loads(data)
  sys.stdout.write(reply['password']+'\n')
except Exception:sys.exit(1)
