import importlib.util,tempfile,io,tarfile,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('pi_backup',Path(__file__).resolve().parents[1]/'tools/mac-song-studio/pi_backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);home=root/'pi';home.mkdir()
 for name,data in [('GuitarPracticeLab/song-library/song/song.json','original'),('GuitarPracticeLab/recordings/song.mp3','audio'),('.config/guitar-lab-browser/Default/Local Storage/state','score'),('GuitarPracticeLab/desktop-controls/request.json','shutdown'),('GuitarPracticeLab/backups/old','skip')]:
  f=home/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(data)
 archive=root/'backup.tar.gz'
 with archive.open('wb') as output:m.backup(home,output)
 with tarfile.open(archive) as t:
  names=t.getnames();assert 'GuitarPracticeLab/song-library/song/song.json' in names;assert '.config/guitar-lab-browser/Default/Local Storage/state' in names;assert not any(n.endswith('request.json') or n.endswith('/old') for n in names)
 target=home/'GuitarPracticeLab/song-library/song/song.json';target.write_text('newer');extra=home/'GuitarPracticeLab/recordings/new.mp3';extra.write_text('keep')
 result=m.restore(home,archive);assert target.read_text()=='original';assert extra.read_text()=='keep';assert (Path(result['safety'])/'GuitarPracticeLab/song-library/song/song.json').read_text()=='newer'
 evil=root/'evil.tar.gz'
 with tarfile.open(evil,'w:gz') as t:
  content=json.dumps({'format':'guitar-lab-backup','version':1}).encode();info=tarfile.TarInfo('GuitarLab-backup.json');info.size=len(content);t.addfile(info,io.BytesIO(content));info=tarfile.TarInfo('../escape');info.size=1;t.addfile(info,io.BytesIO(b'x'))
 try:m.restore(home,evil);raise AssertionError('accepted unsafe path')
 except ValueError:pass
 assert not (root/'escape').exists();assert target.read_text()=='original'
 print('PASS backup selection, browser scores, transient exclusions, restore, safety copies, retained extra files and unsafe path rejection.')
