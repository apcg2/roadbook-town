import { readFile } from 'node:fs/promises';
import { assertValid, escape as esc, safeJSON, hash, dailyLoad } from './model.mjs';
import { buildMap } from './map.mjs';

const template = file => readFile(new URL(`../templates/${file}`,import.meta.url),'utf8');
const date = d => d.slice(5).replace('-','.');
const art = (id,cls='pixel-art',box='0 0 96 96',extra='') => `<svg class="${cls}" aria-hidden="true" viewBox="${box}" ${extra}><use href="#px-${id}"/></svg>`;
export function amapLink(p, hotel=false) {
  const params=new URLSearchParams({src:'roadbook-town',callnative:'1'});
  let endpoint;
  if(hotel || p.kind === 'city' || p.kind === 'area') {endpoint='search';params.set('keyword',hotel?`${p.name} 酒店`:p.name);params.set('city',p.city);params.set('view','list');}
  else if(p.poiId){endpoint='poidetail';params.set('poiid',p.poiId);}
  else {endpoint='marker';params.set('position',p.gcj02.join(','));params.set('name',p.name);params.set('coordinate','gaode');}
  return `https://uri.amap.com/${endpoint}?${params}`;
}
const link=(url,cls,label,icon='amap-link',extra='')=>`<a class="icon-link ${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" ${extra}>${art(icon,'','0 0 24 24')}</a>`;
function food(item){
  const web=`https://www.xiaohongshu.com/search_result?${new URLSearchParams({keyword:item.name,source:'web_search_result_notes'})}`;
  const app=`xhsdiscover://search/result?${new URLSearchParams({keyword:item.name,target_search:'notes',source:'deeplink'})}`;
  return `<li><span>${esc(item.name)}</span>${link(app,'food-search',`搜索${item.name}`,'xhs-search',`data-fallback="${esc(web)}"`)}</li>`;
}
function reviews(r){
  if(r.status==='insufficient') return `<div class="spot-reviews"><h4>小红书网友</h4><p class="review-line">样本不足：${esc(r.reason)}</p></div>`;
  return `<div class="spot-reviews"><h4>小红书网友</h4><div class="review-line">${[['positive','good'],['limitations','mixed']].map(([key,kind])=>`<span class="review-group ${kind}">${art(`review-${kind}`,'','0 0 18 18')}${r[key].map(v=>`<span>${esc(v.text)}</span>`).join('<span class="review-separator" aria-hidden="true">·</span>')}</span>`).join('')}</div></div>`;
}
function event(e,places){
  const p=places.get(e.placeId);
  let content;
  if(e.type==='play') content=`<div class="spot-card"><div class="spot-heading"><h3 class="spot-title">${esc(p.name)}</h3><span class="spot-separator" aria-hidden="true">·</span><span class="spot-place"><span class="spot-location">${esc([...p.address].slice(0,-2).join(''))}<span class="spot-location-tail">${esc([...p.address].slice(-2).join(''))}${link(amapLink(p),'poi-link',`高德查看${p.name}`)}</span></span></span></div><p class="spot-summary">${esc(e.summary)}</p><p class="duration">预计游玩 · <strong>${esc(e.duration)}</strong></p>${reviews(e.reviews)}</div>`;
  else if(e.type==='stay')content=`<div class="stay-row"><p class="event-title">住宿：${esc(p.name)}</p><span class="hotel-slot"><span class="hotel-name">${esc(e.hotel?.name || '酒店待定')}</span>${link(amapLink(e.hotel?places.get(e.hotel.placeId):p,!e.hotel),'hotel-link','高德查看酒店')}</span></div>`;
  else content=`<p class="event-title">${esc(e.text || `${e.type==='arrive'?'抵达':'离开'}${p.name}`)}</p>`;
  return `<li class="event${e.type==='stay'?' stay':''}"><time class="event-time" datetime="${e.date}">${date(e.date)} ${e.period}</time>${content}</li>`;
}
export async function render(trip){
  const validation=assertValid(trip,{requireRoute:true,requireApproval:true});
  const [css,js,icons,defs,note,dialog]=await Promise.all(['style.css','runtime.js','icons.svg','map-defs.svg','note-button.html','checklist.html'].map(template));
  const map=buildMap(trip,defs), places=new Map(trip.places.map(p=>[p.id,p]));
  let lastPlace, legIndex=0;
  const transfers=trip.stops.map(s=>{
    let incoming=null;
    for(const [i,id] of [s.entryPlaceId || s.placeId,...s.events.map(e=>e.type==='stay'&&e.hotel?e.hotel.placeId:e.placeId)].entries()){
      if(lastPlace!==undefined && lastPlace!==id){if(i===0)incoming=trip.route.legs[legIndex];legIndex++;}
      lastPlace=id;
    }
    return incoming;
  });
  const cities=[...new Set(trip.stops.filter(s=>s.role==='visit').map(s=>s.placeId))].map(id=>{const p=places.get(id);return {id,name:p.name,longitude:p.wgs84[0],latitude:p.wgs84[1]};});
  const timeline=trip.stops.map((s,i)=>{
    const p=places.get(s.placeId);
    const distance=i ? `<div class="distance">${Math.round((transfers[i]?.distanceM || 0)/1000)} KM</div>` : '';
    if(s.role!=='visit')return `${distance}<div class="origin" id="stop-${s.id}">${art(s.role==='start'?'car':'home','pixel-art',s.role==='start'?'0 0 72 72':'0 0 96 96')}<div><h2>${esc(p.name)}</h2><p>${date(s.arrive)} · ${s.role==='start'?'出发':'抵达'}</p>${s.events.map(e=>`<p>${esc(e.text || '')}</p>`).join('')}</div></div>`;
    return `${distance}<section class="station" id="stop-${s.id}" aria-labelledby="city-${s.id}"><div class="station-head${[...p.name].length>4?' long-name':''}">${art(s.art||'town')}<div class="station-copy"><div class="station-meta"><p class="date mono">${date(s.arrive)}${s.leave!==s.arrive?'—'+date(s.leave):''}</p><h2 class="city" id="city-${s.id}">${esc(p.name)}</h2><p class="region">${esc(p.region||p.city)}</p></div><div class="weather" data-weather-city="${p.id}" aria-live="polite" aria-label="${esc(p.name)}未来三天天气"><span class="weather-placeholder"></span><span class="weather-placeholder"></span><span class="weather-placeholder"></span></div></div></div><div class="info"><section class="food"><h3>推荐美食</h3><ul>${(s.foods||[]).map(food).join('')}</ul></section><ol class="agenda">${s.events.map(e=>event(e,places)).join('')}</ol></div>${art('route-car','pixel-art route-car','0 0 52 52',`data-car-index="${i}" style="--car-delay:-${(i*.41).toFixed(2)}s"`)}</section>`;
  }).join('');
  const nav=trip.stops.map((s,i)=>`<a href="#stop-${s.id}" aria-label="${esc(places.get(s.placeId).name)}${s.role==='start'?'出发':s.role==='end'?'返回':`第${i}次停留`}">${esc(places.get(s.placeId).name)}</a>`).join('<span class="quick-nav-route" aria-hidden="true"></span>');
  const first=places.get(trip.stops[0].placeId),last=places.get(trip.stops.at(-1).placeId);
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${esc(trip.title)}｜路书小镇</title><style>${css}</style></head><body><main>${icons}<header class="hero">${art('hero','pixel-art','0 0 144 88')}<h1>${esc(trip.title)}<br>自驾行程</h1><p class="period mono">${esc(trip.startDate)} — ${esc(trip.endDate)}</p><p class="caption">${esc(first.name)}出发 · ${first.id===last.id?'返回':'抵达'}${esc(last.name)}</p>${note}</header>${trip.demo?'<p class="demo-notice">虚拟样例 · 地名、道路、里程与口碑仅用于测试</p>':''}<section class="route-overview"><div class="route-map-heading"><span></span><h2>自驾线路图</h2><span></span></div>${map.svg}</section><div class="travel" aria-label="行程路线示意">${timeline}</div><footer>天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>${trip.demo?'':' · 路线数据：高德地图'}</footer></main><nav class="quick-nav" aria-label="城市快捷导航"><div class="quick-nav-track">${nav}</div></nav>${dialog}<script type="application/json" id="roadbook-config">${safeJSON({tripId:trip.id,cities})}</script><script>${js}</script></body></html>`;
  return {html,report:{...validation,...map.report,htmlHash:hash(html),stops:trip.stops.length,weatherGroups:trip.stops.filter(s=>s.role==='visit').length,foodLinks:trip.stops.reduce((n,s)=>n+(s.foods||[]).length,0),hotelLinks:trip.stops.flatMap(s=>s.events).filter(e=>e.type==='stay').length}};
}

export function textPlan(trip){
  const {warnings}=assertValid(trip);
  const places=new Map(trip.places.map(p=>[p.id,p]));
  let text=`# ${trip.title}\n\n${trip.startDate} — ${trip.endDate}\n\n`;
  if(trip.demo)text+='虚拟样例，不作为真实旅行建议。\n\n';
  if(trip.route)text+=`总里程约 ${Math.round(trip.route.legs.reduce((n,l)=>n+l.distanceM,0)/10000)*10} KM（含当地往返）\n\n`;
  for(const s of trip.stops){text+=`## ${s.arrive}—${s.leave} ${places.get(s.placeId).name}\n\n`;if(s.foods?.length)text+=`美食：${s.foods.map(f=>f.name).join('、')}\n\n`;
    for(const e of s.events){const p=places.get(e.placeId);text+=`- ${e.date} ${e.period} · ${e.type==='stay'?'住宿：':e.type==='play'?'游览：':''}${e.text || p.name}${e.type==='play'?` · ${p.address} · 预计游玩 ${e.duration} · ${e.summary}`:''}\n`;if(e.type==='play')text+=`  小红书网友：${e.reviews.status==='insufficient'?`样本不足（${e.reviews.reason}）`:[...e.reviews.positive,...e.reviews.limitations].map(v=>v.text).join(' · ')}\n`;}
    text+='\n';
  }
  if(trip.route)text+='## 驾驶核对\n\n'+trip.route.legs.map(l=>`- ${places.get(l.from).name} → ${places.get(l.to).name}：${(l.distanceM/1000).toFixed(1)} KM，约${Math.round(l.durationS/60)}分钟`).join('\n')+'\n';
  if(trip.route)text+='\n## 每日负担\n\n'+dailyLoad(trip).map(d=>`- ${d.date}：${d.spots}个景点，驾驶约${d.driveMinutes}分钟，游玩约${d.playMinutes}分钟；加20%弹性后约${d.withBufferMinutes}分钟，另需安排完整用餐和休息。`).join('\n')+'\n';
  if(warnings.length)text+='\n## 待核对的安排\n\n'+warnings.map(w=>'- '+w).join('\n')+'\n';
  text+='\n请确认日期、必去项目、每日负担与住宿；确认前不生成正式发布版本。\n';
  return text;
}
