import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {validate,routeStops,routeInputHash,planHash,escape,safeJSON} from '../src/model.mjs';
import {render,amapLink} from '../src/render.mjs';
import {createAmap} from '../src/providers/amap.mjs';
import {createRedfox,screenNotes} from '../src/providers/redfox.mjs';
import {scanText,audit} from '../src/audit.mjs';
import {fileURLToPath} from 'node:url';

const fixture=JSON.parse(await readFile(new URL('./fixtures/virtual.trip.json',import.meta.url),'utf8'));
const publicDemo=JSON.parse(await readFile(new URL('../examples/demo.trip.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(fixture);
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
test('真实数据不能伪装为已查证路线或网友口碑',()=>{const t=copy();t.demo=false;const e=validate(t,{requireRoute:true,requireApproval:true}).errors.join();assert.match(e,/位置尚未核验/);assert.match(e,/口碑缺少/);assert.match(e,/高德道路/);assert.match(e,/尚未确认/);});
test('图文长度受限，缺样本允许',()=>{const t=copy();assert.equal(validate(t).errors.length,0);t.stops[1].events[1].summary='长'.repeat(16);assert.match(validate(t).errors.join(),/15字/);});
test('实际酒店位置参与算路',()=>{const t=copy();t.stops[1].events[2].hotel={name:'示例住宿',placeId:'forest'};assert.deepEqual(routeStops(t),['east','pine','forest','pine','reed','bank','reed','east']);t.stops[1].events.splice(3,1);assert.deepEqual(routeStops(t),['east','pine','forest','reed','bank','reed','east']);});
test('确认哈希不包含确认元数据，内容变化会失效',()=>{const t=copy(),h=planHash(t);t.approval={planHash:h,confirmedAt:'test'};assert.equal(planHash(t),h);t.title+='新';assert.notEqual(planHash(t),h);});
test('位置、数据JSON转义关闭标签与注入',()=>{assert.equal(escape('<b>"'), '&lt;b&gt;&quot;');assert.ok(!safeJSON({text:'</script><script>alert(1)</script>'}).includes('<'));});
test('渲染完整组件、单文件且没有私人sources',async()=>{
  const t=copy();t.sources.push({id:'private-source',url:'https://example.invalid/private-record'});
  const {html,report}=await render(t);
  assert.equal(report.cityLabels,3);assert.equal(report.stayIcons,2);assert.equal(report.playIcons,2);
  assert.equal(report.hotelLinks,2);assert.equal(report.weatherGroups,2);assert.equal(report.foodLinks,6);
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
  t.sources=[{id:'ok',provider:'redfox',accepted:true}];for(const s of t.stops){for(const f of s.foods)f.sourceIds=['ok'];for(const e of s.events)if(e.reviews?.status==='supported')for(const v of [...e.reviews.good,...e.reviews.mixed])v.sourceIds=['ok'];}
  const calls=[];
  const api=createAmap({key:'unit-test',fetchImpl:async url=>{calls.push(url);const u=new URL(url);assert.equal(u.searchParams.get('strategy'),'32');return {ok:true,json:async()=>({status:'1',route:{paths:[{distance:'1000',cost:{duration:'120'},steps:[{polyline:u.searchParams.get('origin')+';'+u.searchParams.get('destination')}]}]}})};}});
  const route=await api.route(t);assert.equal(calls.length,7);assert.equal(route.legs.reduce((n,l)=>n+l.distanceM,0),7000);assert.equal(route.inputHash,routeInputHash(t));
});
test('高德失败不返回假直线，服务消息不泄漏密钥',async()=>{
  const api=createAmap({key:'sensitive-test-value',fetchImpl:async()=>({ok:true,json:async()=>({status:'0',infocode:'10001',info:'sensitive-test-value'})})});
  await assert.rejects(()=>api.search('a','b'),e=>e.message.includes('10001')&&!e.message.includes('sensitive-test-value'));
});
test('Redfox请求头、成功结构与评论限制',async()=>{
  const calls=[];const api=createRedfox({key:'unit-test',fetchImpl:async(url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>({code:2000,data:{items:[]}})};}});
  assert.deepEqual(await api.search('示例'),{items:[]});await api.comments('note-id');
  assert.equal(calls[0][1].headers.REDFOX_API_KEY,'unit-test');assert.equal(JSON.parse(calls[1][1].body).dataNum,20);
});
test('筛选标记广告和重复，不把自动筛选当证实',()=>{const r=screenNotes([{text:'品牌合作体验'},{text:'步行沿河'},{text:'步行沿河'}]);assert.deepEqual(r.map(x=>x.screening),['exclude','needs-agent-review','exclude']);});
test('扫描识别当前Key且工具白名单无发现',async()=>{assert.ok(scanText('prefix-secret-value',['prefix-secret-value']).length);const r=await audit(fileURLToPath(new URL('../',import.meta.url)));assert.deepEqual(r.findings,[]);});
