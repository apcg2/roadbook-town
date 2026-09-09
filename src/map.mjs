import { escape as esc } from './model.mjs';

const intersects = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
function segmentBox(a,b,r) {
  let lo=0, hi=1;
  for (const [start,delta,min,max] of [[a[0],b[0]-a[0],r.x,r.x+r.w],[a[1],b[1]-a[1],r.y,r.y+r.h]]) {
    if (Math.abs(delta)<1e-9) { if (start<min || start>max) return false; }
    else { let u=(min-start)/delta,v=(max-start)/delta; if(u>v)[u,v]=[v,u];lo=Math.max(lo,u);hi=Math.min(hi,v);if(lo>hi)return false; }
  }
  return true;
}
function cross(a,b,c,d) {
  const f=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return f(a,b,c)*f(a,b,d)<-1e-6 && f(c,d,a)*f(c,d,b)<-1e-6;
}
const path = points => points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
export function buildMap(trip, defs) {
  const byId=new Map(trip.places.map(p=>[p.id,p]));
  const ids=[...new Set(trip.stops.map(s=>s.placeId))];
  const stays=new Set(), plays=new Set();
  for (const s of trip.stops) for(const e of s.events) {
    if(e.type==='stay') stays.add(s.placeId);
    if(e.type==='play') plays.add(e.placeId);
  }
  const raw=trip.route.legs.flatMap(l=>l.points);
  const merc = ([lng,lat]) => [lng*Math.PI/180,Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
  const all=[...raw,...trip.places.map(p=>p.gcj02)].map(merc);
  const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  const scale=Math.min(650/Math.max(xmax-xmin,.001),400/Math.max(ymax-ymin,.001));
  const project=c=>{const [x,y]=merc(c);return [480+(x-(xmin+xmax)/2)*scale,390-(y-(ymin+ymax)/2)*scale];};
  const route=trip.route.legs.map(l=>l.points.map(project));
  const segments=route.flatMap(line=>line.slice(1).map((p,i)=>[line[i],p]));
  const occupied=[{x:560,y:0,w:400,h:105}];
  const labelData=[], playData=[];
  const allNodes=[...ids,...plays].map(id=>project(byId.get(id).gcj02));
  function free(rect){return rect.x>=12&&rect.y>=110&&rect.x+rect.w<=948&&rect.y+rect.h<=688&&!occupied.some(r=>intersects(rect,r))&&!segments.some(([a,b])=>segmentBox(a,b,rect))&&!allNodes.some(p=>segmentBox(p,p,rect));}
  const clearLeader=(line)=>line.slice(1).every((p,i)=>!segments.some(([a,b])=>cross(line[i],p,a,b))&&!occupied.some(r=>segmentBox(line[i],p,r)));
  // The direct and one-bend leaders below keep the map spare in ordinary
  // cases. Dense real-road clusters sometimes need a small orthogonal detour.
  // This grid walk is a last resort: it never crosses the route or a label.
  function routedLeader(start,end){
    const step=12, snap=p=>[Math.round(p[0]/step)*step,Math.round(p[1]/step)*step], s=snap(start), goal=snap(end);
    const key=p=>`${p[0]},${p[1]}`, queue=[s], came=new Map([[key(s),null]]), point=new Map([[key(s),s]]);
    const valid=(a,b,first)=>b[0]>=8&&b[0]<=952&&b[1]>=108&&b[1]<=692&&!occupied.some(r=>segmentBox(a,b,r))&&(!first&&!segments.some(([u,v])=>cross(a,b,u,v)));
    for(let head=0;head<queue.length&&queue.length<5000;head++){
      const a=queue[head];
      if(Math.abs(a[0]-goal[0])<=step&&Math.abs(a[1]-goal[1])<=step&&valid(a,end,false)){
        const line=[end];let k=key(a);while(k){line.push(point.get(k));k=came.get(k);}line.reverse();
        const simplified=[line[0]];for(let i=1;i<line.length-1;i++){const p=simplified.at(-1),q=line[i],r=line[i+1];if((q[0]-p[0])*(r[1]-q[1])!==(q[1]-p[1])*(r[0]-q[0]))simplified.push(q);}simplified.push(line.at(-1));
        return simplified;
      }
      for(const [dx,dy] of [[step,0],[-step,0],[0,step],[0,-step]]){const b=[a[0]+dx,a[1]+dy],k=key(b);if(came.has(k)||!valid(a,b,a===s))continue;came.set(k,key(a));point.set(k,b);queue.push(b);}
    }
    return null;
  }
  // Lay out the densest city cluster first so an early, isolated label cannot
  // consume the only collision-free leader-line corridor for a nearby city.
  const labelIds=[...ids].sort((a,b)=>{
    const nearest=id=>Math.min(...ids.filter(other=>other!==id).map(other=>Math.hypot(project(byId.get(id).gcj02)[0]-project(byId.get(other).gcj02)[0],project(byId.get(id).gcj02)[1]-project(byId.get(other).gcj02)[1])));
    return nearest(a)-nearest(b);
  });
  for (const id of labelIds) {
    const place=byId.get(id), node=project(place.gcj02), stay=stays.has(id);
    const w=[...place.name].length*27+(stay?25:0),h=40;
    let best=null;
    const override=trip.mapLabels?.[id];
    const candidates=override?[[override.x,override.y]]:[];
    if(!override) for(const radius of [35,55,80,110,150,200,260,330,400,480]) for(let a=0;a<24;a++) {
      const angle=a*Math.PI/12;
      candidates.push([node[0]+Math.cos(angle)*radius-w/2,node[1]+Math.sin(angle)*radius-h/2]);
    }
    for (const [x,y] of candidates) {
      const box={x:x-8,y:y-8,w:w+16,h:h+16}; if(!free(box))continue;
      const end=[Math.max(x-3,Math.min(x+w+3,node[0])),Math.max(y-3,Math.min(y+h+3,node[1]))];
      const attempts=[[node,end],[node,[node[0],end[1]],end],[node,[end[0],node[1]],end]];
      // A reviewed `forceLeader` is reserved for a genuinely enclosed node.
      // Its label box still has to clear the route and all other labels.
      const leader=attempts.find(clearLeader) || routedLeader(node,end) || (override?.forceLeader?[node,end]:null);
      if(leader){best={id,x,y,w,h,box,node,leader,stay,name:place.name};break;}
    }
    if(!best)throw new Error(`地图标注无法避让：${place.name}；调整 mapLabels 或减少密集节点后重试，禁止挪动真实坐标`);
    occupied.push(best.box);labelData.push(best);
  }
  for(const id of plays){
    const node=project(byId.get(id).gcj02);let item;
    const candidates=[[16,-10],[-22,-10],[16,28],[-22,28],[35,-25],[-38,30],[45,40],[-45,-35]];
    for(const radius of [60,85,115,150])for(let a=0;a<12;a++){
      const angle=a*Math.PI/6;candidates.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);
    }
    for(const [dx,dy] of candidates){
      const x=node[0]+dx,y=node[1]+dy,box={x:x-12,y:y-25,w:27,h:38};
      if(free(box)){item={id,node,x,y,box};break;}
    }
    if(!item)throw new Error(`游玩图标无法避让：${byId.get(id).name}`);
    occupied.push(item.box);playData.push(item);
  }
  const totalM=trip.route.legs.reduce((s,l)=>s+l.distanceM,0),totalKM=Math.round(totalM/10000)*10;
  let arrows='';
  const every=Math.max(1,Math.floor(segments.length/5));
  for(let i=Math.floor(every/2);i<segments.length && (arrows.match(/route-arrow/g)||[]).length<5;i+=every){
    const [a,b]=segments[i],p=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    if(occupied.some(r=>intersects({x:p[0]-10,y:p[1]-10,w:20,h:20},r)))continue;
    arrows+=`<g class="route-arrow" transform="translate(${p}) rotate(${Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI})"><path d="M-6-5H0V-8L8 0 0 8V5H-6Z"/></g>`;
  }
  const routeD=route.map(path).join(' ');
  const svg=`<svg class="route-map" viewBox="0 0 960 700" role="img" aria-labelledby="map-title map-desc"><title id="map-title">${trip.demo?'虚拟线路示意':'自驾线路图'}</title><desc id="map-desc">${trip.demo?'虚拟测试数据，不代表真实道路。':'按高德道路和统一地理比例绘制。'}小屋表示住宿，旗帜表示游玩。</desc><defs>${defs}<clipPath id="boundary-clip"><rect width="960" height="700"/></clipPath></defs><rect class="map-paper" width="960" height="700"/><rect width="960" height="700" fill="url(#map-grid)"/><g clip-path="url(#boundary-clip)">${(trip.route.boundaries||[]).map(b=>`<path class="province" d="${path(b.map(project))}Z"/>`).join('')}</g><path class="route-under" d="${routeD}"/><path class="route-main" d="${routeD}"/>${arrows}<g class="map-total"><text class="map-total-text" x="930" y="44" text-anchor="end">总里程约 ${totalKM} KM</text><g class="map-legend" aria-label="小屋表示住宿，旗帜表示游玩"><use href="#map-stay" transform="translate(785 77) scale(.72)"/><text class="map-legend-text" x="807" y="83">住宿</text><use href="#map-play" transform="translate(860 77) scale(.72)"/><text class="map-legend-text" x="880" y="83">游玩</text></g></g>${labelData.map(l=>`<g class="city-mark"><use href="#map-city-node" transform="translate(${l.node})"/><path class="city-leader" d="${path(l.leader)}"/>${[l.node,l.leader.at(-1)].map(p=>`<rect class="city-leader-end" x="${p[0]-2}" y="${p[1]-2}" width="4" height="4"/>`).join('')}<text class="map-city-label" x="${l.x}" y="${l.y+30}">${esc(l.name)}</text>${l.stay?`<use class="label-stay" href="#map-stay" transform="translate(${l.x+l.w-13} ${l.y+17}) scale(.72)"/>`:''}</g>`).join('')}${playData.map(p=>`<g class="map-icon"><path class="icon-leader" d="${path([p.node,[p.x,p.y]])}"/><use href="#map-play" transform="translate(${p.x} ${p.y})"/></g>`).join('')}</svg>`;
  return {svg,report:{routeHash:trip.route.inputHash,totalM,totalKM,cityLabels:labelData.length,stayIcons:stays.size,playIcons:plays.size,labelCollisions:0,projection:'uniform Mercator',labels:labelData.map(({id,x,y,w,h})=>({id,x,y,w,h}))}};
}
