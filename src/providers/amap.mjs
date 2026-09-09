import { jsonRequest } from './http.mjs';
import { routeStops, routeInputHash, assertValid, coordValid } from '../model.mjs';

export function createAmap({key,fetchImpl=fetch}={}){
  if(!key)throw new Error('未配置 AMAP_WEB_SERVICE_KEY；参考 docs/setup.md');
  async function call(path,params){
    const url=new URL(`https://restapi.amap.com/${path}`);
    url.search=new URLSearchParams({...params,key}).toString();
    const r=await jsonRequest(url,{fetchImpl});
    if(r.status!=='1')throw new Error(`高德接口失败（代码 ${String(r.infocode||'unknown').replace(/[^0-9a-z_-]/gi,'')}），请检查权限、额度与参数`);
    return r;
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
