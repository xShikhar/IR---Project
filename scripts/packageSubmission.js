import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv.find(arg=>arg.startsWith('--name='))?.slice(7)||'CSD358_Shikhar_Antra_Bhupesh_Raghavendra';
if(!/^[A-Za-z0-9_-]{1,120}$/.test(name))throw new Error('Use a simple name with letters, digits, hyphens or underscores.');
for(const required of ['data/corpus.json','data/index.json','output/pdf/TurnTrace2_Report.pdf','client/dist/index.html']) {
  if(!fs.existsSync(path.join(root,required)))throw new Error(`Missing ${required}. Build the client and render the report before packaging.`);
}
const out=path.join(root,'output','submission');
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(out,'.staging-'));
const destination=path.join(temp,name);
fs.mkdirSync(destination);
const excluded=new Set(['node_modules','.git','.agents','.codex','tmp','test-results','playwright-report','frozen']);
const include=['server','client','eval','data','docs','scripts','tests','package.json','package-lock.json','README.md','.gitignore','playwright.config.js','requirements-report.txt'];
try {
  for(const item of include) {
    const source=path.join(root,item);
    if(fs.existsSync(source))fs.cpSync(source,path.join(destination,item),{recursive:true,filter:file=>!excluded.has(path.basename(file))});
  }
  fs.copyFileSync(path.join(root,'output','pdf','TurnTrace2_Report.pdf'),path.join(destination,'TurnTrace2_Report.pdf'));
  const archive=path.join(out,`${name}.zip`);
  const result=spawnSync(process.platform==='win32'?'tar.exe':'tar',['-a','-c','-f',archive,'-C',temp,name],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('The system tar utility could not create the submission ZIP.');
  console.log(`Submission archive: ${archive}`);
  console.log(`Size: ${(fs.statSync(archive).size/1024/1024).toFixed(1)} MB. Includes source, frozen dataset, semantic cache, report and built client.`);
} finally {
  // Only this process's newly created staging directory can be removed.
  if(path.dirname(temp)!==out||!path.basename(temp).startsWith('.staging-'))throw new Error('Unsafe staging path.');
  fs.rmSync(temp,{recursive:true,force:true});
}
