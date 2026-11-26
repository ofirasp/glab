#!/usr/bin/env python3
import os,plistlib,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent
output=Path(sys.argv[1]).resolve();output.mkdir(parents=True,exist_ok=True);stage=tempfile.TemporaryDirectory(prefix='glab-studio-build-');app=Path(stage.name)/'Guitar Lab Song Studio.app';mac=app/'Contents/MacOS';resources=app/'Contents/Resources';mac.mkdir(parents=True,exist_ok=True);resources.mkdir(parents=True,exist_ok=True)
subprocess.run(['swiftc','-O','-module-cache-path',str(output/'swift-module-cache'),'-target','x86_64-apple-macosx11.0','-framework','AppKit',str(root/'main.swift'),'-o',str(mac/'SongStudio')],check=True)
for name in ['worker.py','remote_import.py','pi_backup.py','README.txt']:shutil.copyfile(root/name,resources/name)
shutil.copyfile(root.parent/'mac-backing/make-backing.py',resources/'make-backing.py')
iconset=Path(stage.name)/'Studio.iconset';iconset.mkdir()
icon=Path(stage.name)/'icon.png'
subprocess.run(['swiftc','-O','-module-cache-path',str(output/'swift-module-cache'),'-framework','AppKit',str(root/'icon.swift'),'-o',str(Path(stage.name)/'make-icon')],check=True)
subprocess.run([str(Path(stage.name)/'make-icon'),str(icon)],check=True)
for size in [16,32,128,256,512]:
 for scale in [1,2]:
  name='icon_'+str(size)+'x'+str(size)+('@2x' if scale==2 else '')+'.png'
  subprocess.run(['/usr/bin/sips','-z',str(size*scale),str(size*scale),str(icon),'--out',str(iconset/name)],stdout=subprocess.DEVNULL,check=True)
subprocess.run(['/usr/bin/iconutil','-c','icns',str(iconset),'-o',str(resources/'Studio.icns')],check=True)
(app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleName':'Guitar Lab Song Studio','CFBundleDisplayName':'Guitar Lab Song Studio','CFBundleIdentifier':'local.guitarlab.songstudio','CFBundleExecutable':'SongStudio','CFBundlePackageType':'APPL','CFBundleShortVersionString':'2.2.0','CFBundleVersion':'6','CFBundleIconFile':'Studio.icns','LSMinimumSystemVersion':'11.0','NSHighResolutionCapable':True,'NSPrincipalClass':'NSApplication','NSHumanReadableCopyright':'Guitar Practice Lab'}))
for attribute in ['com.apple.FinderInfo','com.apple.ResourceFork']:
 subprocess.run(['/usr/bin/xattr','-dr',attribute,str(app)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
delivery=output/app.name
if delivery.exists():shutil.rmtree(delivery)
shutil.copytree(app,delivery,copy_function=shutil.copy)
for attribute in ['com.apple.FinderInfo','com.apple.ResourceFork']:
 subprocess.run(['/usr/bin/xattr','-dr',attribute,str(delivery)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['codesign','--verify','--deep','--strict',str(delivery)],check=True)
archive=output/'Guitar Lab Song Studio.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as bundle:
 for file in app.rglob('*'):
  if file.is_file():bundle.write(file,app.name+'/'+str(file.relative_to(app)))
print(delivery)
stage.cleanup()
