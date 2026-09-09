import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
const allowedRoot=new Set(['README.md','AGENTS.md','LICENSE','package.json','package-lock.json','.gitignore','.env.example','docs','src','templates','schemas','examples','tests','scripts']);
const skipped=new Set(['.git','private','output','node_modules','.env','.env.local','.wrangler','.DS_Store']);
export async function publicFiles(root){
  const files=[];
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
    if(dir===root && skipped.has(e.name))continue;
    if(dir===root && !allowedRoot.has(e.name))throw new Error(`公开目录中存在未允许文件：${e.name}`);
    const p=join(dir,e.name),stat=await lstat(p);
    if(stat.isSymbolicLink())throw new Error('公开文件不能使用符号链接');
    if(e.isDirectory())await walk(p);else files.push(p);
  }}
  await walk(root);return files;
}
export function scanText(text,secrets=[]){
  const findings=[];
  if(/(?:AMAP_WEB_SERVICE_KEY|REDFOX_API_KEY)\s*[=:]\s*["']?(?!\s*["']?\s*[,;\n}])[A-Za-z0-9_-]{20,}/.test(text))findings.push('疑似明文接口密钥');
  if(/(?:gh[pousr]_|github_pat_|sk_live_)[A-Za-z0-9_]{15,}/.test(text))findings.push('疑似访问令牌');
  if(/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text))findings.push('包含个人电脑绝对路径');
  for(const secret of secrets.filter(s=>typeof s==='string'&&s.length>10))if(text.includes(secret))findings.push('包含当前配置密钥');
  return findings;
}
export async function audit(root){
  const files=await publicFiles(root),findings=[];
  for(const file of files){
    const text=await readFile(file,'utf8');
    for(const issue of scanText(text,Object.entries(process.env).filter(([k])=>/KEY|TOKEN|SECRET/.test(k)).map(([,v])=>v)))findings.push(`${relative(root,file)}：${issue}`);
  }
  return {files:files.length,findings,note:'自动扫描不代替对历史、截图和第三方数据的人工审查；公开发布尚未执行。'};
}
