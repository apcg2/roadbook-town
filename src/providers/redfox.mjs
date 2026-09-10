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
