import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
export const dateValid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
export const coordValid = c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && c[0] >= 73 && c[0] <= 136 && c[1] >= 18 && c[1] <= 54;
export const periods = ['早上','上午','中午','下午','傍晚','晚上'];
export const icons = ['town','mountains','lake','cave','river','village','hamlet','bridge','skyline','arcade'];
export const normalizeLabel = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
// `mapLabels` only controls collision-free SVG text placement. It cannot alter
// dates, stops, places, route coordinates, or any approved travel content.
export function planHash(trip) { const { approval, mapLabels, ...content } = trip; return hash(content); }
export function routeStops(trip) {
  const points = [];
  for (const stop of trip.stops) {
    for (const placeId of [stop.entryPlaceId || stop.placeId, ...stop.events.map(e => e.type === 'stay' && e.hotel ? e.hotel.placeId : e.placeId)]) {
      if (points.at(-1) !== placeId) points.push(placeId);
    }
  }
  return points;
}
export function routeInputHash(trip) {
  return hash({ points: routeStops(trip).map(id => [id,trip.places.find(p => p.id === id)?.gcj02]), strategy:32, cartype:0 });
}
export function dailyLoad(trip) {
  const days=new Map();
  const day=date=>{if(!days.has(date))days.set(date,{date,driveMinutes:0,playMinutes:0,spots:0});return days.get(date);};
  let last, index=0;
  for(const stop of trip.stops){
    const visits=[{placeId:stop.entryPlaceId || stop.placeId,date:stop.arrive},...stop.events.map(e=>({...e,placeId:e.type==='stay'&&e.hotel?e.hotel.placeId:e.placeId}))];
    for(const e of visits){
      const d=day(e.date);
      if(last!==undefined && last!==e.placeId){d.driveMinutes+=(trip.route?.legs[index]?.durationS || 0)/60;index++;}
      last=e.placeId;
      if(e.type==='play'){d.playMinutes+=e.minutes;d.spots++;}
    }
  }
  return [...days.values()].map(d=>({...d,driveMinutes:Math.round(d.driveMinutes),withBufferMinutes:Math.round((d.driveMinutes+d.playMinutes)*1.2)}));
}
export function validate(trip, { requireRoute = false, requireApproval = false } = {}) {
  const errors = [], warnings = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(trip && typeof trip === 'object', '行程必须是对象');
  if (!trip || typeof trip !== 'object') return {errors,warnings};
  check(trip.version === 1, '不支持的数据版本');
  check(idPattern.test(trip.id || ''), 'trip.id 必须是稳定英文ID');
  check(typeof trip.title === 'string' && [...trip.title].length <= 30 && trip.title.length > 0, '标题需为1—30字');
  check(dateValid(trip.startDate) && dateValid(trip.endDate) && trip.endDate >= trip.startDate, '行程日期无效');
  const places = Array.isArray(trip.places) ? trip.places : [];
  const stops = Array.isArray(trip.stops) ? trip.stops : [];
  check(places.length > 0, '地点不能为空');
  check(stops.length >= 2 && stops.length <= 50, '需2—50个到访段');
  const byId = new Map(places.map(p => [p.id,p]));
  check(byId.size === places.length, '地点ID重复');
  check(new Set(stops.map(s=>s.id)).size === stops.length, '到访段ID重复');
  const sources = new Map((trip.sources || []).map(s => [s.id,s]));
  for (const p of places) {
    check(idPattern.test(p.id || ''), '地点ID无效');
    check(typeof p.name === 'string' && p.name.length > 0, '地点缺少名称');
    check(typeof p.city === 'string' && typeof p.address === 'string', `${p.id} 缺少城市/位置`);
    check(['city','poi','area'].includes(p.kind), `${p.id} 地点类型无效`);
    check(coordValid(p.gcj02), `${p.id} 缺少有效高德坐标`);
    check(!p.wgs84 || coordValid(p.wgs84), `${p.id} 天气坐标无效`);
    if (!trip.demo) check(p.verified === true, `${p.id} 位置尚未核验`);
    if (p.poiId) check(/^[A-Za-z0-9]+$/.test(p.poiId), `${p.id} POI ID无效`);
  }
  let previous = '', nightDates = new Set(), playCounts = new Map();
  const attractionsByCity=new Map();
  for (const [i, stop] of stops.entries()) {
    check(idPattern.test(stop.id || ''), '到访段ID无效');
    const city = byId.get(stop.placeId);
    check(city?.kind === 'city', `${stop.id} 需要城市节点`);
    check(!stop.entryPlaceId || byId.has(stop.entryPlaceId), `${stop.id} 入城首站不存在`);
    check(dateValid(stop.arrive) && dateValid(stop.leave) && stop.arrive <= stop.leave, `${stop.id} 停留日期无效`);
    check(stop.arrive >= trip.startDate && stop.leave <= trip.endDate, `${stop.id} 停留超出行程日期`);
    check(!i || stop.arrive >= stops[i-1].leave, `${stop.id} 到访段错序`);
    check(icons.includes(stop.art || 'town'), `${stop.id} 插画类型无效`);
    check(stop.role === (i === 0 ? 'start' : i === stops.length-1 ? 'end' : 'visit'), `${stop.id} 首尾角色无效`);
    if (stop.role === 'visit') check(coordValid(city?.wgs84), `${stop.id} 缺少独立天气坐标`);
    if (stop.role !== 'visit') check(!(stop.foods || []).length, '首尾专用节点不显示美食');
    if (stop.role === 'visit') {
      const playTotal=(stop.events || []).filter(e=>e.type==='play').length;
      check(playTotal >= 1 && playTotal <= 3, `${city?.name || stop.id} 应安排2—3个不同景点（当前${playTotal}个）；若时间或可靠资料仅支持1个，须填写 sightShortfallReason`);
      if(playTotal===1)check(typeof stop.sightShortfallReason==='string' && stop.sightShortfallReason.trim().length>0, `${city?.name || stop.id} 仅安排1个景点时必须填写 sightShortfallReason`);
      check((stop.foods || []).length===5, `${city?.name || stop.id} 必须推荐恰好5项地方美食（当前${(stop.foods || []).length}项）；请补查“地名＋菜品”或当地官方资料`);
    }
    const foodNames=new Set();
    for (const food of stop.foods || []) {
      check(typeof food.name === 'string' && food.name.length > 0 && food.name.length <= 30, '美食名称无效');
      const foodKey=normalizeLabel(food.name).replace(normalizeLabel(city?.name).replace(/[市县区]$/u,''),'');
      check(foodKey && !foodNames.has(foodKey), `${city?.name || stop.id} 存在重复美食：${food.name}`);foodNames.add(foodKey);
      if (!trip.demo) check((food.sourceIds || []).some(id => sources.get(id)?.accepted===true), `${food.name} 缺少已接受的来源记录`);
    }
    check(Array.isArray(stop.events) && stop.events.length > 0, `${stop.id} 缺少事件`);
    for (const e of stop.events || []) {
      check(['arrive','play','stay','depart'].includes(e.type), '事件类型无效');
      check(byId.has(e.placeId), '事件引用不存在的地点');
      check(dateValid(e.date) && e.date >= stop.arrive && e.date <= stop.leave, '事件日期超出停留日期');
      check(periods.includes(e.period), '事件时段无效');
      const stamp = `${e.date}:${periods.indexOf(e.period)}`;
      check(stamp >= previous, '事件时间倒序'); previous = stamp;
      if (e.type === 'stay') {
        check(!nightDates.has(e.date), `${e.date} 重复住宿`); nightDates.add(e.date);
        check(e.date < trip.endDate, '末日住宿不在行程内');
        check(stop.role === 'visit', '首尾专用节点不安排住宿');
        if (e.hotel) check(typeof e.hotel.name === 'string' && byId.has(e.hotel.placeId), '酒店需有名称和核验位置');
      }
      if (e.type === 'play') {
        check(stop.role === 'visit', '首尾专用节点不安排游玩');
        const attraction=byId.get(e.placeId), cityKey=stop.placeId;
        if(!attractionsByCity.has(cityKey))attractionsByCity.set(cityKey,{place:new Set(),canonical:new Set(),poi:new Set(),name:new Set()});
        const seen=attractionsByCity.get(cityKey), canonical=attraction?.canonicalAttractionId, poi=attraction?.poiId, name=normalizeLabel(attraction?.name);
        check(typeof canonical==='string' && idPattern.test(canonical), `${city?.name || stop.id} 的${attraction?.name || e.placeId}缺少有效 canonicalAttractionId；请核验景点并填写稳定规范标识`);
        check(!seen.place.has(e.placeId), `${city?.name || stop.id} 重复安排同一景点：${attraction?.name || e.placeId}`);
        if(canonical)check(!seen.canonical.has(canonical), `${city?.name || stop.id} 重复安排同一规范景点：${attraction?.name || canonical}`);
        if(poi)check(!seen.poi.has(poi), `${city?.name || stop.id} 重复安排同一高德POI：${attraction?.name || poi}`);
        if(name)check(!seen.name.has(name), `${city?.name || stop.id} 重复安排同名景点：${attraction?.name}`);
        seen.place.add(e.placeId);if(canonical)seen.canonical.add(canonical);if(poi)seen.poi.add(poi);if(name)seen.name.add(name);
        playCounts.set(e.date,(playCounts.get(e.date)||0)+1);
        check(typeof e.summary === 'string' && [...e.summary].length > 0 && [...e.summary].length <= 15, '景点介绍需1—15字');
        check(typeof e.duration === 'string' && e.duration.length > 0, '缺少预计游玩');
        check(Number.isFinite(e.minutes) && e.minutes >= 0, '缺少用于排程的游玩分钟数');
        const r = e.reviews;
        check(r && ['supported','insufficient'].includes(r.status), '缺少口碑状态');
        if (r?.status === 'supported') {
          check(r.good?.length === 2 && r.mixed?.length === 2, '口碑须2条正面、2条中性/负面');
          for (const item of [...(r.good || []),...(r.mixed || [])]) {
            check(typeof item.text === 'string' && [...item.text].length > 0 && [...item.text].length <= 5, '口碑短语需1—5字');
            if (!trip.demo) check((item.sourceIds || []).some(id => sources.get(id)?.provider === 'redfox' && sources.get(id)?.accepted === true), '口碑缺少已筛选小红书来源');
          }
        }
      }
    }
  }
  const expectedNights = Math.round((Date.parse(trip.endDate)-Date.parse(trip.startDate))/86400000);
  check(nightDates.size === expectedNights, `住宿应有${expectedNights}晚，实际${nightDates.size}晚`);
  for (const [date,count] of playCounts) if (count > 3) warnings.push(`${date} 有${count}个景点，超出默认1—3个`);
  if (requireRoute || trip.route) {
    const r = trip.route, ids = routeStops(trip);
    check(!!r, '尚未取得驾车路线');
    if (r) {
      check(r.inputHash === routeInputHash(trip), '路线过期：途经点/坐标已修改，须重新算路');
      check(r.provider === (trip.demo ? 'synthetic' : 'amap'), '真实行程必须使用高德道路折线');
      check(r.legs?.length === ids.length-1, '路线分段数量不匹配');
      for (const [i,l] of (r.legs || []).entries()) {
        check(l.from === ids[i] && l.to === ids[i+1], '路线途经点错序');
        check(Number.isFinite(l.distanceM) && l.distanceM >= 0 && Number.isFinite(l.durationS) && l.durationS >= 0, '距离/时间无效');
        check(l.points?.length >= 2 && l.points.every(coordValid), '道路折线无效');
        if (l.points?.length >= 2 && byId.has(l.from) && byId.has(l.to)) {
          const diff = (a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
          check(diff(l.points[0],byId.get(l.from).gcj02) < .025 && diff(l.points.at(-1),byId.get(l.to).gcj02) < .025, '道路端点偏离途经点');
        }
      }
      for (const boundary of r.boundaries || []) check(Array.isArray(boundary) && boundary.length >= 3 && boundary.every(coordValid), '行政区轮廓无效');
    }
  }
  if (requireApproval && !trip.demo) check(trip.approval?.planHash === planHash(trip) && !!trip.approval.confirmedAt, '行程尚未确认或确认后已修改');
  if (!errors.length) for(const day of dailyLoad(trip)) {
    if(day.driveMinutes>(day.spots?240:360))warnings.push(`${day.date} 驾驶约${day.driveMinutes}分钟，超出默认节奏；须在草稿说明调整或用户已接受的取舍`);
    if(day.withBufferMinutes>600)warnings.push(`${day.date} 驾驶和游玩加20%余量超过10小时，尚未计入完整用餐/休息`);
  }
  return {errors,warnings};
}
export function assertValid(trip, options) {
  const report = validate(trip, options);
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  return report;
}
