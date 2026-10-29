'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Include tracked and non-ignored new files, never Git internals or dependencies.
const names=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))]
 .filter(name=>name!=='MANIFEST.sha256'&&fs.existsSync(path.join(root,name))).sort();
const lines=names.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')+'  '+name);
fs.writeFileSync(path.join(root,'MANIFEST.sha256'),lines.join('\n')+'\n');
console.log('Updated manifest: '+names.length+' files');
