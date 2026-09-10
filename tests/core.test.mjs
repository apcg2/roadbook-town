import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {validate,routeStops,routeInputHash,planHash,escape,safeJSON,migrateToV3} from '../src/model.mjs';
import {render,amapLink} from '../src/render.mjs';
import {createAmap} from '../src/providers/amap.mjs';
import {createRedfox,screenNotes,foodSearchQueries,researchFood,attractionSearchQueries,researchAttraction} from '../src/providers/redfox.mjs';
import {scanText,audit} from '../src/audit.mjs';
import {fileURLToPath} from 'node:url';

const fixture=JSON.parse(await readFile(new URL('./fixtures/virtual.trip.json',import.meta.url),'utf8'));
const publicDemo=JSON.parse(await readFile(new URL('../examples/demo.trip.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(fixture);
const publicCopy=()=>structuredClone(publicDemo);
test('公开广东示例路线完整且不携带私有检索字段',()=>{
  assert.equal(publicDemo.demo,false);
  assert.deepEqual(validate(publicDemo,{requireRoute:true,requireApproval:true}).errors,[]);
  assert.equal(publicDemo.route.legs.reduce((total,leg)=>total+leg.distanceM,0),994642);
  assert.ok(!JSON.stringify(publicDemo).includes('privateFile'));
});
test('虚拟示例合法并包含景点往返',()=>{
  assert.deepEqual(validate(copy(),{requireRoute:true}).errors,[]);
  assert.deepEqual(routeStops(copy()),['east','pine','forest','pine','reed','bank','reed','east']);
});
test('位置修改使道路数据失效',()=>{const t=copy();t.places[1].gcj02[0]+=.01;assert.match(validate(t,{requireRoute:true}).errors.join(),/路线过期/);});
test('先游览后入住不强制绕到城市中心',()=>{const t=copy();t.stops[1].entryPlaceId='forest';t.stops[1].events[0].placeId='forest';assert.deepEqual(routeStops(t),['east','forest','pine','reed','bank','reed','east']);});
test('住宿遗漏、重复和错误日期被拒绝',()=>{
  for(const mutate of [t=>t.stops[1].events.splice(2,1),t=>t.stops[1].events.push(t.stops[1].events[2]),t=>t.stops[1].events[1].date='2030-02-30']){
    const t=copy();mutate(t);assert.ok(validate(t).errors.length);
  }
});
test('重复城市允许，重复到访段ID拒绝',()=>{const t=copy();assert.equal(validate(t).errors.length,0);t.stops[3].id=t.stops[0].id;assert.match(validate(t).errors.join(),/ID重复/);});
test('真实数据不能伪装为已查证路线或网友口碑',()=>{const t=copy();t.demo=false;t.sources.find(s=>s.id==='forest-post-a').accepted=false;const e=validate(t,{requireRoute:true,requireApproval:true}).errors.join();assert.match(e,/位置尚未核验/);assert.match(e,/口碑缺少/);assert.match(e,/高德道路/);assert.match(e,/尚未确认/);});
test('图文长度受限，缺样本允许',()=>{const t=copy();assert.equal(validate(t).errors.length,0);t.stops[1].events[1].summary='长'.repeat(16);assert.match(validate(t).errors.join(),/15字/);});
test('途中城市必须恰好有5项不同且有来源的地方美食',()=>{
  for(const [label,mutate] of [
    ['0项',t=>t.stops[1].foods=[]],
    ['4项',t=>t.stops[1].foods=t.stops[1].foods.slice(0,4)],
    ['6项',t=>t.stops[1].foods.push({name:'第六种示例菜',sourceIds:[]})],
    ['同名',t=>t.stops[1].foods[4].name=t.stops[1].foods[0].name]
  ]){const t=copy();mutate(t);assert.match(validate(t).errors.join(),label==='同名'?/重复美食/:/恰好5项/);}
  const real=publicCopy();real.stops[1].foods[0].sourceIds=[];
  assert.match(validate(real).errors.join(),/厚街烧鹅濑粉 缺少已接受的来源记录/);
});
test('每城景点数量与短缺原因是硬约束',()=>{
  const none=copy();delete none.route;none.stops[1].events=none.stops[1].events.filter(e=>e.type!=='play');
  assert.match(validate(none).errors.join(),/松风县 应安排2—3个不同景点（当前0个）/);
  const one=copy();delete one.stops[1].sightShortfallReason;
  assert.match(validate(one).errors.join(),/sightShortfallReason/);
  const four=copy();delete four.route;const stop=four.stops[1],base=four.places.find(p=>p.id==='forest'),play=stop.events.find(e=>e.type==='play');
  for(let n=2;n<=4;n++){const place={...structuredClone(base),id:`forest-${n}`,name:`松间步道${n}`,canonicalAttractionId:`forest-walk-${n}`,gcj02:[base.gcj02[0]+n/1000,base.gcj02[1]],wgs84:[base.wgs84[0]+n/1000,base.wgs84[1]]};four.places.push(place);stop.events.splice(2,0,{...structuredClone(play),placeId:place.id});}
  assert.match(validate(four).errors.join(),/松风县 应安排2—3个不同景点（当前4个）/);
});
test('旧数据缺少景点规范标识时给出城市和修复提示',()=>{const t=copy();delete t.places.find(p=>p.id==='forest').canonicalAttractionId;assert.match(validate(t).errors.join(),/松风县.*canonicalAttractionId.*填写稳定规范标识/);});
test('同城景点按地点ID、规范ID、高德POI和标准化名称去重',()=>{
  const variants=[
    ['地点ID',t=>t.places.find(p=>p.id==='forest')],
    ['规范ID',t=>({...structuredClone(t.places.find(p=>p.id==='forest')),id:'forest-alt',name:'另一景点'})],
    ['高德POI',t=>{const p=t.places.find(p=>p.id==='forest');p.poiId='B0TEST001';return {...structuredClone(p),id:'forest-alt',name:'另一景点',canonicalAttractionId:'forest-alt'};}],
    ['标准化名称',t=>({...structuredClone(t.places.find(p=>p.id==='forest')),id:'forest-alt',name:'松 间步道',canonicalAttractionId:'forest-alt'})]
  ];
  const expected={地点ID:/重复安排同一景点/,规范ID:/重复安排同一规范景点/,高德POI:/重复安排同一高德POI/,标准化名称:/重复安排同名景点/};
  for(const [kind,makePlace] of variants){const t=copy();delete t.route;const stop=t.stops[1],place=makePlace(t);if(place.id!=='forest')t.places.push(place);const play=structuredClone(stop.events.find(e=>e.type==='play'));play.placeId=place.id;stop.events.splice(2,0,play);assert.match(validate(t).errors.join(),expected[kind]);}
});
test('实际酒店位置参与算路',()=>{const t=copy();t.stops[1].events[2].hotel={name:'示例住宿',placeId:'forest'};assert.deepEqual(routeStops(t),['east','pine','forest','pine','reed','bank','reed','east']);t.stops[1].events.splice(3,1);assert.deepEqual(routeStops(t),['east','pine','forest','reed','bank','reed','east']);});
test('确认哈希不包含确认元数据，内容变化会失效',()=>{const t=copy(),h=planHash(t);t.approval={planHash:h,confirmedAt:'test'};assert.equal(planHash(t),h);t.title+='新';assert.notEqual(planHash(t),h);});
test('位置、数据JSON转义关闭标签与注入',()=>{assert.equal(escape('<b>"'), '&lt;b&gt;&quot;');assert.ok(!safeJSON({text:'</script><script>alert(1)</script>'}).includes('<'));});
test('渲染完整组件、单文件且没有私人sources',async()=>{
  const t=copy();t.sources.push({id:'private-source',url:'https://example.invalid/private-record'});
  const {html,report}=await render(t);
  assert.equal(report.cityLabels,3);assert.equal(report.stayIcons,2);assert.equal(report.playIcons,2);
  assert.equal(report.hotelLinks,2);assert.equal(report.weatherGroups,2);assert.equal(report.foodLinks,10);
  assert.equal((html.match(/class="quick-nav-route"/g)||[]).length,3);
  assert.ok(!html.includes('private-record'));assert.ok(!html.includes('map-total-rule'));
  assert.ok(html.includes('样本不足'));assert.ok(html.includes('roadbook-town:checklist:v1:'));
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]);
});
test('公开地图标签不包含景点名称',async()=>{const {html}=await render(copy());const map=html.slice(html.indexOf('<svg class="route-map"'),html.indexOf('<div class="travel"'));assert.ok(map.includes('松风县'));assert.ok(!map.includes('松间步道'));});
test('同源输入重渲染哈希一致',async()=>{assert.equal((await render(copy())).report.htmlHash,(await render(copy())).report.htmlHash);});
test('POI、坐标、城市搜索链接分支',()=>{
  const p=copy().places[3];assert.match(amapLink(p),/\/marker\?/);assert.match(amapLink({...p,poiId:'B012TEST'}),/\/poidetail\?/);
  assert.match(amapLink(copy().places[0]),/\/search\?/);assert.ok(amapLink(copy().places[0],true).includes('%E9%85%92%E5%BA%97'));
});
test('高德发送推荐策略，逐点路线无重复求和',async()=>{
  const t=copy();t.demo=false;delete t.route;for(const p of t.places)p.verified=true;
  t.sources.push({id:'ok',provider:'official',accepted:true});for(const s of t.stops)for(const f of s.foods)f.sourceIds=['ok'];
  const calls=[];let clock=0;
  const api=createAmap({key:'unit-test',now:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async url=>{calls.push(url);const u=new URL(url);assert.equal(u.searchParams.get('strategy'),'32');return {ok:true,status:200,json:async()=>({status:'1',route:{paths:[{distance:'1000',cost:{duration:'120'},steps:[{polyline:u.searchParams.get('origin')+';'+u.searchParams.get('destination')}]}]}})};}});
  const route=await api.route(t);assert.equal(calls.length,7);assert.equal(route.legs.reduce((n,l)=>n+l.distanceM,0),7000);assert.equal(route.inputHash,routeInputHash(t));
});
test('高德并发请求共用队列，任意1秒最多启动3次',async()=>{
  let clock=0;const starts=[];
  const api=createAmap({key:'unit-test',now:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>{starts.push(clock);return {ok:true,status:200,json:async()=>({status:'1',pois:[]})};}});
  await Promise.all(['a','b','c','d'].map(word=>api.search(word,'测试市')));
  assert.deepEqual(starts,[0,350,700,1050]);
  for(const start of starts)assert.ok(starts.filter(other=>other>=start&&other<start+1000).length<=3);
});
test('高德只重试QPS错误，退避两次且其他业务错误不重试',async()=>{
  for(const code of ['10019','10020','10021']){let clock=0,calls=0;const sleeps=[];
    const api=createAmap({key:'unit-test',now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;},fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>calls<3?({status:'0',infocode:code}):({status:'1',pois:[]})};}});
    assert.deepEqual(await api.search('a','b'),[]);assert.equal(calls,3);assert.ok(sleeps.includes(1000));assert.ok(sleeps.includes(2000));
  }
  let dailyCalls=0;const daily=createAmap({key:'unit-test',fetchImpl:async()=>{dailyCalls++;return {ok:true,status:200,json:async()=>({status:'0',infocode:'10003'})};}});
  await assert.rejects(()=>daily.search('a','b'),/日调用量/);assert.equal(dailyCalls,1);
});
test('高德失败不返回假直线，服务消息不泄漏密钥',async()=>{
  const api=createAmap({key:'sensitive-test-value',fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'0',infocode:'10001',info:'sensitive-test-value'})})});
  await assert.rejects(()=>api.search('a','b'),e=>e.message.includes('10001')&&!e.message.includes('sensitive-test-value'));
});
test('Redfox只提供搜索和正文详情接口',async()=>{
  const calls=[];const api=createRedfox({key:'unit-test',fetchImpl:async(url,opts)=>{calls.push([url,opts]);return {ok:true,status:200,json:async()=>({code:2000,data:{items:[]}})};}});
  assert.deepEqual(await api.search('示例'),{items:[]});await api.detail('note-id');
  assert.equal(calls[0][1].headers.REDFOX_API_KEY,'unit-test');assert.equal(api.comments,undefined);assert.equal(api.commentResult,undefined);
});
test('美食检索先查城市类目，再按城市和菜品补查并去重',()=>{
  assert.deepEqual(foodSearchQueries('柳州',['螺蛳粉','柳州 螺蛳粉','螺蛳粉']),['柳州 美食','柳州 特色美食','柳州 特色小吃','柳州 螺蛳粉']);
});
test('美食补查逐词保存原始数量与失败状态',async()=>{
  const calls=[];const results=await researchFood({search:async keyword=>{calls.push(keyword);if(keyword.includes('特色小吃'))throw new Error('额度不足');return {items:keyword.endsWith('螺蛳粉')?[{id:1},{id:2}]:[]};}},'柳州',['螺蛳粉']);
  assert.deepEqual(calls,['柳州 美食','柳州 特色美食','柳州 特色小吃','柳州 螺蛳粉']);
  assert.deepEqual(results.map(x=>[x.keyword,x.status,x.count]),[['柳州 美食','ok',0],['柳州 特色美食','ok',0],['柳州 特色小吃','error',0],['柳州 螺蛳粉','ok',2]]);
  assert.equal(results.at(-1).data.items.length,2);assert.match(results[2].error,/额度不足/);
});
test('筛选标记广告和重复，不把自动筛选当证实',()=>{const r=screenNotes([{text:'品牌合作体验'},{text:'步行沿河'},{text:'步行沿河'}]);assert.deepEqual(r.map(x=>x.screening),['exclude','needs-agent-review','exclude']);});
test('景点研究使用五组查询且只采集正文',async()=>{
  assert.deepEqual(attractionSearchQueries('阳朔','遇龙河景区'),['阳朔 遇龙河景区','遇龙河景区 攻略','遇龙河景区 真实体验','遇龙河景区 避雷','遇龙河景区 排队 停车']);
  let commentCalls=0;const api={search:async keyword=>({list:[{workId:'w'+keyword.length,accountUserid:'a'+keyword.length,workTitle:keyword,workDesc:'真实体验'}]}),detail:async workId=>({workId,workDesc:'正文'}),comments:async()=>{commentCalls++;}};
  const bundle=await researchAttraction(api,{city:'阳朔',place:'遇龙河景区'});
  assert.equal(bundle.searches.length,5);assert.equal(bundle.status,'complete');assert.ok(bundle.notes.every(n=>n.detail));assert.equal(commentCalls,0);assert.equal('commentTasks' in bundle,false);
});
test('正文详情失败时保持pending并可恢复',async()=>{
  let fail=true;const api={search:async keyword=>({list:[{workId:'w'+keyword,accountUserid:'a'+keyword,workTitle:keyword,workDesc:'摘要'}]}),detail:async workId=>{if(fail)throw new Error('临时失败');return {workId,workDesc:'正文'};}};
  const first=await researchAttraction(api,{city:'阳朔',place:'西街'});assert.equal(first.status,'pending');
  fail=false;const resumed=await researchAttraction(api,{city:'阳朔',place:'西街',resume:first});assert.equal(resumed.status,'complete');assert.ok(resumed.notes.every(n=>n.detail));
});
test('pending口碑阻止出稿，旧数据迁移会清除确认',()=>{
  const t=copy();t.stops[1].events[1].reviews={status:'pending',reason:'任务未完成',research:{status:'pending',attempts:[],candidateCount:0,acceptedCount:0,authorCount:0}};
  assert.match(validate(t).errors.join(),/口碑研究未完成/);
  const old=copy();old.version=2;old.approval={planHash:'old',confirmedAt:'old'};old.stops[1].events[1].reviews.limitations[0].sourceType='comment';const migrated=migrateToV3(old);
  assert.equal(migrated.version,3);assert.equal(migrated.approval,undefined);assert.equal(migrated.stops[1].events[1].reviews.status,'pending');
});
test('正文口碑须覆盖至少两位作者',()=>{
  const one=copy();one.sources.filter(s=>s.id==='forest-post-b').forEach(s=>s.authorRef='author-a');assert.match(validate(one).errors.join(),/至少2位不同作者/);
  const comment=copy();comment.sources[0].evidenceType='comment';assert.match(validate(comment).errors.join(),/不允许的评论来源/);
});
test('限制评价支持1条、2条或样本不足',async()=>{
  const one=copy();one.stops[1].events[1].reviews.limitations.length=1;assert.deepEqual(validate(one).errors,[]);
  const partial=copy(),r=partial.stops[1].events[1].reviews;r.status='partial';r.reasonCode='limitation-shortfall';r.limitations=[];assert.deepEqual(validate(partial).errors,[]);
  const html=(await render(partial)).html;assert.ok(html.includes('样本不足'));
  const none=copy();none.stops[1].events[1].reviews.limitations=[];assert.match(validate(none).errors.join(),/使用partial/);
});
test('扫描识别当前Key且工具白名单无发现',async()=>{assert.ok(scanText('prefix-secret-value',['prefix-secret-value']).length);const r=await audit(fileURLToPath(new URL('../',import.meta.url)));assert.deepEqual(r.findings,[]);});
