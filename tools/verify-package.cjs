const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');let count=0;
for(const line of fs.readFileSync(path.join(root,'MANIFEST.sha256'),'utf8').trim().split(/\r?\n/)){
 const [hash,name]=line.split('  ');const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');if(hash!==actual)throw Error('Hash mismatch: '+name);count++;
}console.log('PASS '+count+' files');
