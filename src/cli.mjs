#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, access, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { assertValid, validate, hash, planHash } from './model.mjs';
import { render, textPlan } from './render.mjs';
import { audit, scanText } from './audit.mjs';
import { createAmap } from './providers/amap.mjs';
import { createRedfox } from './providers/redfox.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const [command,...args]=process.argv.slice(2);
const flag=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
async function save(path,value){await mkdir(dirname(path),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function env(){
  try{const text=await readFile(join(root,'.env.local'),'utf8');for(const line of text.split(/\r?\n/)){
    const m=line.match(/^(AMAP_WEB_SERVICE_KEY|REDFOX_API_KEY)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');
  }}catch(e){if(e.code!=='ENOENT')throw new Error('无法读取本地配置');}
}
function run(program,argv){return new Promise((done,fail)=>{const child=spawn(program,argv,{stdio:'inherit',shell:false});child.on('error',()=>fail(new Error(`无法启动 ${basename(program)}，请先安装或设置 WRANGLER_BIN`)));child.on('exit',code=>code===0?done():fail(new Error(`命令退出码 ${code}`)));});}
async function main(){
  await env();
  if(command==='doctor'){
    console.log(JSON.stringify({node:process.version,amap:process.env.AMAP_WEB_SERVICE_KEY?'已配置（未联网核验）':'未配置',redfox:process.env.REDFOX_API_KEY?'已配置（未联网核验）':'未配置',instructions:'docs/setup.md'},null,2));return;
  }
  if(command==='demo'){
    const trip=await json(join(root,'examples/demo.trip.json'));
    const result=await render(trip);
    await save(join(root,'output/demo/index.html'),result.html);await save(join(root,'output/demo/report.json'),result.report);await save(join(root,'output/demo/plan.md'),textPlan(trip));
    console.log('已生成 output/demo/index.html（公开示例行程）');return;
  }
  if(command==='init'){
    const destination=resolve(args[0]||join(root,'private/trip.json'));
    try{await access(destination);throw new Error('目标已存在，不覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
    await mkdir(dirname(destination),{recursive:true});await copyFile(join(root,'examples/blank.trip.json'),destination);
    console.log('已创建待填写草稿；先阅读 AGENTS.md 收集用户需求。');return;
  }
  if(command==='validate'){
    const report=validate(await json(args[0]),{requireRoute:args.includes('--route'),requireApproval:args.includes('--approved')});console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;return;
  }
  if(command==='plan'){
    const trip=await json(args[0]);await save(flag('--out')||join(root,'private/plan.md'),textPlan(trip));console.log('文本草稿已生成，请向用户展示并取得确认。');return;
  }
  if(command==='approve-plan'){
    if(!args.includes('--user-confirmed'))throw new Error('仅在用户明确确认当前文本行程后添加 --user-confirmed');
    const trip=await json(args[0]);assertValid(trip,{requireRoute:true});
    trip.approval={planHash:planHash(trip),confirmedAt:new Date().toISOString()};await save(args[0],trip);console.log('已记录此版本的行程确认；修改内容会使确认失效。');return;
  }
  if(command==='render'){
    const result=await render(await json(args[0]));const out=resolve(flag('--out')||join(root,'output/trip/index.html'));
    await save(out,result.html);await save(join(dirname(out),'report.json'),result.report);console.log('网页及验收数据已生成；请预览后再确认发布。');return;
  }
  if(command==='route'){
    const trip=await json(args[0]);if(trip.demo)throw new Error('虚拟示例不调用真实地图');
    trip.route=await createAmap({key:process.env.AMAP_WEB_SERVICE_KEY}).route(trip);delete trip.approval;assertValid(trip,{requireRoute:true});await save(args[0],trip);console.log('道路、时间及总里程已更新；请重新生成文本供用户确认。');return;
  }
  if(command==='poi'){
    if(!args[0] || !flag('--city'))throw new Error('用法：poi 关键词 --city 城市');
    const pois=await createAmap({key:process.env.AMAP_WEB_SERVICE_KEY}).search(args[0],flag('--city'));
    await save(flag('--out')||join(root,'private/pois.json'),{queriedAt:new Date().toISOString(),pois});console.log('候选POI已写入私有文件，请核对再选坐标。');return;
  }
  if(command==='research'){
    const r=createRedfox({key:process.env.REDFOX_API_KEY});let data;
    if(flag('--detail'))data=await r.detail(flag('--detail'));
    else if(flag('--comments'))data=await r.comments(flag('--comments'));
    else if(flag('--task'))data=await r.commentResult(flag('--task'));
    else {if(!args[0])throw new Error('需提供关键词');data=await r.search(args[0]);}
    await save(flag('--out')||join(root,'private/research.json'),{provider:'redfox',queriedAt:new Date().toISOString(),untrusted:true,data});console.log('查询材料已保存到私有文件；须人工/Agent筛选并保留来源，不能直接当作推荐。');return;
  }
  if(command==='preview'){
    const file=resolve(args[0]||join(root,'output/demo/index.html'));
    await access(file);const port=Number(flag('--port')||4173);
    createServer(async(req,res)=>{if(req.url?.split('?')[0]!=='/'){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(500);res.end('预览读取失败');}}).listen(port,'127.0.0.1',()=>console.log(`本机预览 http://127.0.0.1:${port}`));return;
  }
  if(command==='audit'){
    const report=await audit(root);console.log(JSON.stringify(report,null,2));if(report.findings.length)process.exitCode=1;return;
  }
  if(command==='deploy'){
    if(!args.includes('--user-confirmed'))throw new Error('仅在用户确认网页并同意公开后添加 --user-confirmed');
    const trip=await json(args[0]);if(trip.demo)throw new Error('虚拟样例不作为个人正式行程发布');
    const project=flag('--project');if(!project||!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project))throw new Error('需要有效的 --project 名称');
    const result=await render(trip),secrets=[process.env.AMAP_WEB_SERVICE_KEY,process.env.REDFOX_API_KEY];
    if(scanText(result.html,secrets).length)throw new Error('发布内容未通过密钥检查');
    const approval=flag('--html-sha');if(approval!==hash(result.html))throw new Error('须使用预览report.json中的htmlHash作为 --html-sha，确保发布已确认的成品');
    const stage=await mkdtemp(join(tmpdir(),'roadbook-publish-'));await save(join(stage,'index.html'),result.html);
    const wrangler=process.env.WRANGLER_BIN||'wrangler';
    await run(wrangler,['pages','deploy',stage,'--project-name',project,'--branch','main']);
    const url=`https://${project}.pages.dev/`;let verified=false;
    for(let n=0;n<5;n++){try{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.ok && hash(await response.text())===hash(result.html)){verified=true;break;}}catch{}await new Promise(r=>setTimeout(r,2000));}
    if(!verified)throw new Error('上传已执行，但生产地址尚未核对一致；请核查部署状态后再宣布成功');
    await save(join(root,'private/publication.json'),{project,url,htmlHash:hash(result.html),publishedAt:new Date().toISOString()});console.log(`发布并核对成功：${url}`);return;
  }
  console.log('路书小镇 · roadbook-town\n命令：doctor | init [文件] | demo | validate 文件 [--route] [--approved] | poi 关键词 --city 城市 | research 关键词 [--detail ID|--comments ID|--task ID] | route 文件 | plan 文件 | approve-plan 文件 --user-confirmed | render 文件 | preview [HTML] | audit | deploy 文件 --project 名称 --html-sha 哈希 --user-confirmed\n先阅读 README.md 和 AGENTS.md。');
}
main().catch(error=>{
  let message=String(error.message||'操作失败');for(const key of [process.env.AMAP_WEB_SERVICE_KEY,process.env.REDFOX_API_KEY])if(key)message=message.split(key).join('[已隐藏]');
  console.error(message);process.exitCode=1;
});
