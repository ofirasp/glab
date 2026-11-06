"""Run only against an isolated app started with tests/fixtures on PATH and empty test result storage."""
import urllib.request,urllib.error,json,time
from pathlib import Path
import os
base=os.environ.get('GPL_TEST_API','http://127.0.0.1:5106/api/chord-practice')
passed=[]
def call(path,body=None,expected=200):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'} if body is not None else {})
 try:r=urllib.request.urlopen(req,timeout=20)
 except urllib.error.HTTPError as e:r=e
 data=json.load(r);assert r.status==expected,(r.status,data);return data
def check(name,value):assert value,name;passed.append(name);print('PASS',name,flush=True)
for _ in range(30):
 try:devices=call('/devices');break
 except urllib.error.URLError:time.sleep(1)
check('ALSA capture devices enumerated',devices['available'] and 'default' in devices['devices'])
call('/start',{'first':'C#','second':'Db'},400);check('equivalent chords rejected before capture',True)
call('/start',{'first':'C','second':'G','device':'test-failure'},400);check('capture failure is reported without a timed result',len(call('/history'))==0)
state=call('/start',{'first':'C','second':'G','device':'held'});time.sleep(2);state=call('/active');check('held chord counts once',state['correctChords']==1 and state['target']=='G')
call('/start',{'first':'Am','second':'D'},409);check('second microphone session blocked',True)
call('/'+state['id']+'/cancel',{});time.sleep(.3);check('cancel does not save partial rounds',not call('/history'))
state=call('/start',{'first':'C','second':'G'});start=time.monotonic();check('ready microphone starts sixty-second timer',state['status']=='running' and 58<=state['remaining']<=60)
while time.monotonic()-start<66:
 state=call('/active')
 if state['status']!='running':break
 time.sleep(1)
check('round ends after sixty seconds',state['status']=='completed' and 59<=time.monotonic()-start<=65)
check('alternating guitar signal counted',state['correctChords']>=40 and state['changes']==state['correctChords']-1)
check('result saved on server',state['saved'] and state['result']['seconds']==60)
history=call('/history');check('result available after loading history again',len(history)==1 and history[0]['id']==state['id'])
call('/'+state['id']+'/save',{});check('retry save is idempotent',len(call('/history'))==1)
print(json.dumps({'checks':passed,'final':state},indent=2))
