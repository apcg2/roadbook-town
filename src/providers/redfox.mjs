import { jsonRequest } from './http.mjs';

export function foodSearchQueries(city,dishes=[]){
  const place=String(city||'').trim();if(!place)throw new Error('美食检索缺少城市');
  const clean=dishes.map(value=>String(value||'').trim()).filter(Boolean);
  const dishQueries=clean.map(dish=>dish.replace(place,'').trim()).filter(Boolean).map(dish=>`${place} ${dish}`);
  return [...new Set([`${place} 美食`,`${place} 特色美食`,`${place} 特色小吃`,...dishQueries])];
}

export async function researchFood(redfox,city,dishes=[]){
  const results=[];
  for(const keyword of foodSearchQueries(city,dishes)){
    try{const data=await redfox.search(keyword);const items=Array.isArray(data?.list)?data.list:Array.isArray(data?.items)?data.items:[];results.push({keyword,status:'ok',count:items.length,data});}
    catch(error){results.push({keyword,status:'error',count:0,error:String(error.message||'查询失败')});}
  }
  return results;
}

export function attractionSearchQueries(city,place){
  const c=String(city||'').trim(),p=String(place||'').trim();
  if(!c||!p)throw new Error('景点研究缺少城市或景点');
  return [...new Set([`${c} ${p}`,`${p} 攻略`,`${p} 真实体验`,`${p} 避雷`,`${p} 排队 停车`])];
}

const listOf=data=>Array.isArray(data?.list)?data.list:Array.isArray(data?.items)?data.items:[];
const workIdOf=item=>String(item?.workId||item?.id||'');
const authorOf=item=>String(item?.accountUserid||item?.authorId||item?.userId||'');
const doneStatus=value=>/^(success|succeeded|complete|completed|done|finished)$/i.test(String(value||''));
const pendingStatus=value=>/^(pending|waiting|processing|running|submitted)$/i.test(String(value||''));

export async function researchAttraction(redfox,{city,place,resume,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=120000,onProgress=async()=>{}}={}){
  const bundle=resume?structuredClone(resume):{version:1,provider:'redfox',scope:'attraction',city,place,untrusted:true,status:'pending',createdAt:new Date(now()).toISOString(),searches:[],notes:[],commentTasks:[]};
  if(bundle.city!==city||bundle.place!==place)throw new Error('恢复文件与城市/景点不匹配');
  if(!bundle.searches.length){
    for(const keyword of attractionSearchQueries(city,place)){
      try{const data=await redfox.search(keyword),items=listOf(data);bundle.searches.push({keyword,status:'ok',count:items.length,data});}
      catch(error){bundle.searches.push({keyword,status:'error',count:0,error:String(error.message||'查询失败')});}
      await onProgress(bundle);
    }
    const all=bundle.searches.flatMap(x=>x.status==='ok'?listOf(x.data):[]),seen=new Set(),authors=new Set(),chosen=[];
    for(const item of all){const id=workIdOf(item),author=authorOf(item);if(!id||seen.has(id))continue;if(author&&!authors.has(author)){chosen.push(item);seen.add(id);authors.add(author);}}
    for(const item of all){const id=workIdOf(item);if(id&&!seen.has(id)&&chosen.length<8){chosen.push(item);seen.add(id);}}
    bundle.notes=screenNotes(chosen.slice(0,8).map(item=>({workId:workIdOf(item),authorRef:authorOf(item),title:item.workTitle||'',text:[item.workTitle,item.workDesc].filter(Boolean).join('\n'),url:item.workUrl||''})));
  }
  for(const note of bundle.notes.filter(n=>n.screening!=='exclude')){
    if(!note.detail){try{note.detail=await redfox.detail(note.workId);}catch(error){note.detailError=String(error.message||'详情查询失败');}await onProgress(bundle);}
    if(!bundle.commentTasks.some(t=>t.workId===note.workId)){
      try{const data=await redfox.comments(note.workId);bundle.commentTasks.push({workId:note.workId,taskId:String(data?.taskId||''),status:'pending',submittedAt:new Date(now()).toISOString(),data});}
      catch(error){bundle.commentTasks.push({workId:note.workId,status:'error',error:String(error.message||'评论任务失败')});}await onProgress(bundle);
    }
  }
  const deadline=now()+timeoutMs;
  while(bundle.commentTasks.some(t=>t.status==='pending')&&now()<deadline){
    for(const task of bundle.commentTasks.filter(t=>t.status==='pending')){
      if(!task.taskId){task.status='error';task.error='评论任务缺少taskId';continue;}
      try{const data=await redfox.commentResult(task.taskId),state=data?.status||data?.taskStatus||data?.state;task.lastCheckedAt=new Date(now()).toISOString();
        if(doneStatus(state)||Array.isArray(data?.list)||Array.isArray(data?.comments)){task.status='complete';task.data=data;}
        else if(state&&!pendingStatus(state)){task.status='error';task.error=`评论任务状态异常：${String(state).slice(0,30)}`;}
      }catch(error){task.lastError=String(error.message||'评论查询失败');}
      await onProgress(bundle);
    }
    if(bundle.commentTasks.some(t=>t.status==='pending')&&now()<deadline)await sleep(Math.min(5000,Math.max(0,deadline-now())));
  }
  bundle.status=bundle.commentTasks.some(t=>t.status==='pending')?'pending':'complete';bundle.updatedAt=new Date(now()).toISOString();
  bundle.summary={attempts:bundle.searches.map(({keyword,status,count,error})=>({keyword,status,count,error})),candidateCount:bundle.notes.length,acceptedCount:bundle.notes.filter(n=>n.screening!=='exclude').length,authorCount:new Set(bundle.notes.filter(n=>n.screening!=='exclude').map(n=>n.authorRef).filter(Boolean)).size,commentCompleteCount:bundle.commentTasks.filter(t=>t.status==='complete').length,commentErrorCount:bundle.commentTasks.filter(t=>t.status==='error').length};
  await onProgress(bundle);return bundle;
}

// Endpoints/headers verified against the provider's public SDK on 2026-09-09.
// No provider SDK source is bundled. The returned data remains untrusted research material.
export function createRedfox({key,fetchImpl=fetch}={}){
  if(!key)throw new Error('未配置 REDFOX_API_KEY；参考 docs/setup.md');
  async function call(path,body){
    const r=await jsonRequest(`https://redfox.hk${path}`,{fetchImpl,method:'POST',attempts:1,headers:{'Content-Type':'application/json','REDFOX_API_KEY':key},body:JSON.stringify(body)});
    if(r.code && r.code!==2000)throw new Error(`Redfox接口失败（代码 ${String(r.code).replace(/[^0-9a-z_-]/gi,'')}）；请检查权限或额度`);
    return r.data ?? r;
  }
  return {
    search:(keyword,offset=0)=>call('/story/api/xhsUser/searchArticle',{keyword,offset,sortType:'0'}),
    detail:workId=>call('/story/api/xhsUser/queryWorkDetail',{workId}),
    comments:opusId=>call('/story/api/xhs/commentSubmit',{opusId,dataNum:20}),
    commentResult:taskId=>call('/story/api/xhs/commentResult',{taskId})
  };
}
export function screenNotes(notes){
  const seen=new Set();
  return notes.map(n=>{
    const text=String(n.text||''),normalized=text.replace(/\s/g,'');
    const reason=/(商业合作|品牌合作|置换体验|团购链接|商务合作|加[微vV]|私信领取|推广合作)/.test(text)?'明显推广线索':seen.has(normalized)?'重复内容':null;
    seen.add(normalized);
    return {...n,screening:reason?'exclude':'needs-agent-review',reason};
  });
}
