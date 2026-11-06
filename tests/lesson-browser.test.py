"""Desktop helper checks use fake browser processes; no real website is opened."""
import importlib.util,json,tempfile,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('lesson_browser',Path(__file__).resolve().parents[1]/'src/GuitarPracticeLab.Web/Desktop/lesson-browser.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Fake:
 def __init__(self,args,**kwargs):self.args=args;self.ended=False
 def poll(self):return 0 if self.ended else None
 def terminate(self):self.ended=True
 def kill(self):self.ended=True
 def wait(self,**kwargs):return 0
calls=[]
def launch(args,**kwargs):p=Fake(args,**kwargs);calls.append(p);return p
with tempfile.TemporaryDirectory() as folder:
 b=module.Browser(Path(folder),launch);b.executable='/test/chromium'
 def command(id,action,url=''):return {'id':id,'action':action,'url':url,'created':time.time()}
 b.handle(command('1','open','https://www.justinguitar.com/songs'))
 assert len(calls)==1 and b.running()
 assert '--kiosk' not in calls[0].args and '--start-maximized' in calls[0].args
 assert calls[0].args[-2].endswith('/lesson-return.html') and calls[0].args[-1]=='https://www.justinguitar.com/songs'
 assert any(a.endswith('guitar-lab-lessons') for a in calls[0].args)
 b.handle(command('1','open','https://example.com'));assert len(calls)==1
 b.handle(command('2','open','https://www.guitarzero2hero.com/songs'));assert len(calls)==2 and '--new-tab' in calls[1].args
 original=b.process;b.handle(command('3','close'));assert original.ended and b.process is None
 b.handle({'id':'expired','action':'open','url':'https://example.com','created':time.time()-60});assert len(calls)==2
 try:b.handle(command('4','open','javascript:alert(1)'));raise AssertionError('unsafe URL accepted')
 except ValueError:pass
 b.status();state=json.loads((Path(folder)/'status.json').read_text());assert state['available'] and not state['running']
 print('PASS dedicated profile, maximized window, Return tab, reuse, duplicate/expired requests, close and URL validation')
