import { jsonRequest } from './http.mjs';
import { routeStops, routeInputHash, assertValid, coordValid } from '../model.mjs';

export function createAmap({key,fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),minIntervalMs=350}={}){
  if(!key)throw new Error('未配置 AMAP_WEB_SERVICE_KEY；参考 docs/setup.md');
  let gate=Promise.resolve(),nextStart=0;
  function throttle(){
    const turn=gate.then(async()=>{
      const wait=Math.max(0,nextStart-now());if(wait)await sleep(wait);
      nextStart=Math.max(nextStart,now())+minIntervalMs;
    });
    gate=turn.catch(()=>{});return turn;
  }
  async function call(path,params){
    const rateCodes=new Set(['10019','10020','10021']);
    for(let attempt=0;attempt<3;attempt++){
      await throttle();
      const url=new URL(`https://restapi.amap.com/${path}`);
      url.search=new URLSearchParams({...params,key}).toString();
      // Keep retries in this provider so every Amap attempt passes through the
      // shared process-local start queue.
      const r=await jsonRequest(url,{fetchImpl,attempts:1});
      if(r.status==='1')return r;
      const code=String(r.infocode||'unknown').replace(/[^0-9a-z_-]/gi,'');
      if(rateCodes.has(code)&&attempt<2){await sleep(attempt===0?1000:2000);continue;}
      if(rateCodes.has(code))throw new Error(`高德接口触发QPS限制（代码 ${code}），已限速并重试2次；请稍后再试，且不要并行启动多个高德命令`);
      if(['10003','10044'].includes(code))throw new Error(`高德接口日调用量已用尽（代码 ${code}），请检查账号额度或次日再试`);
      if(['10002','10012','10041'].includes(code))throw new Error(`高德接口权限不可用（代码 ${code}），请检查Web服务Key及路径规划、POI或行政区权限`);
      throw new Error(`高德接口失败（代码 ${code}），请检查Key、参数与服务状态`);
    }
  }
  return {
    async search(keyword,city){return (await call('v5/place/text',{keywords:keyword,region:city,city_limit:'true',page_size:'10'})).pois||[];},
    async boundaries(province){
      const r=await call('v3/config/district',{keywords:province,subdistrict:'0',extensions:'all'});
      if(r.districts?.length!==1 || !r.districts[0].polyline)throw new Error(`行政区位置不明确：${province}`);
      return r.districts[0].polyline.split('|').map(v=>v.split(';').map(c=>c.split(',').map(Number)));
    },
    async route(trip){
      assertValid({...trip,route:undefined});
      const ids=routeStops(trip), places=new Map(trip.places.map(p=>[p.id,p]));
      const legs=[];
      for(let i=1;i<ids.length;i++){
        const a=places.get(ids[i-1]), b=places.get(ids[i]);
        if(a.gcj02.join()===b.gcj02.join()){legs.push({from:a.id,to:b.id,distanceM:0,durationS:0,points:[a.gcj02,b.gcj02]});continue;}
        const r=await call('v5/direction/driving',{origin:a.gcj02.join(','),destination:b.gcj02.join(','),strategy:'32',cartype:'0',show_fields:'polyline,cost'});
        const p=r.route?.paths?.[0];
        const points=(p?.steps||[]).flatMap(s=>(s.polyline||'').split(';').filter(Boolean).map(c=>c.split(',').map(Number)));
        if(!p || points.length<2 || !points.every(coordValid) || p.distance==null || p.cost?.duration==null)throw new Error(`高德路线缺少距离、时间或道路折线：${a.name} → ${b.name}`);
        legs.push({from:a.id,to:b.id,distanceM:Number(p.distance),durationS:Number(p.cost.duration),points});
      }
      const boundaries=[];
      for(const province of new Set(trip.provinces || []))boundaries.push(...await this.boundaries(province));
      return {provider:'amap',strategy:32,cartype:0,queriedAt:new Date().toISOString(),inputHash:routeInputHash(trip),legs,boundaries};
    }
  };
}
