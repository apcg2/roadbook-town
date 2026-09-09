import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {planHash} from '../src/model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)), out=join(root,'output/qa');
await mkdir(out,{recursive:true});
const tripFile=process.env.ROADBOOK_TRIP || join(root,'examples/demo.trip.json');
const trip=JSON.parse(await readFile(tripFile,'utf8'));
const visitStops=trip.stops.filter(s=>s.role==='visit');
const expected={nav:trip.stops.length,weather:visitStops.length*3,stay:new Set(trip.stops.flatMap(s=>s.events.filter(e=>e.type==='stay').map(()=>s.placeId))).size,play:trip.stops.flatMap(s=>s.events).filter(e=>e.type==='play').length,visit:visitStops.length};
const {html}=await render(trip);
const longTrip=structuredClone(trip);
longTrip.places[1].name='松风山水自治县';
longTrip.places[3].address='松风山水自治县示例镇示例街道沿河步行入口附近的长地址测试';
if(longTrip.approval) longTrip.approval.planHash=planHash(longTrip);
const {html:longHTML}=await render(longTrip);
const chrome=process.env.CHROME_BIN || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome');
await access(chrome);
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/long'?longHTML:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'roadbook-browser-'));
const processChrome=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let ws;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let port;
  for(let i=0;i<60;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(150);}}
  if(!port)throw new Error('Chrome未启动');
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let serial=0,weatherMode='normal',weatherCalls=0,weatherCodes=[0,3,61];
  const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP超时：${method}`));},12000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  const dates=Array.from({length:3},(_,i)=>new Date(Date.now()+8*3600000+i*86400000).toISOString().slice(0,10));
  const payload=()=>visitStops.map(()=>({daily:{time:dates,weather_code:weatherCodes,temperature_2m_max:[26,25,24],temperature_2m_min:[18,17,16]}}));
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id){const p=pending.get(msg.id);if(p){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}}
    if(msg.method==='Fetch.requestPaused'){
      weatherCalls++;const requestId=msg.params.requestId;
      if(weatherMode==='timeout')return;
      if(weatherMode==='offline')send('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'}).catch(()=>{});
      else {
        const data=payload();if(weatherMode==='missing')data[0].daily.temperature_2m_min[0]=null;
        if(weatherMode==='stale')data[0].daily.time=['2000-01-01','2000-01-02','2000-01-03'];
        send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')}).catch(()=>{});
      }
    }
  });
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+': '+r.exceptionDetails.exception?.description);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'https://api.open-meteo.com/*'}]});
  const reports=[];
  for(const width of [360,390,430,1100]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<500});
    await send('Emulation.setTouchEmulationEnabled',{enabled:width<500,maxTouchPoints:width<500?5:1});
    await send('Page.navigate',{url});await delay(550);
    const report=await evaluate(`(()=>{
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,nav:document.querySelectorAll('.quick-nav a').length,selected:document.querySelectorAll('[aria-current="location"]').length,weather:document.querySelectorAll('.weather-day').length,stay:document.querySelectorAll('.label-stay').length,play:document.querySelectorAll('.map-icon').length,headers:[...document.querySelectorAll('.station-copy')].map(e=>({text:box(e.querySelector('.station-meta')),weather:box(e.querySelector('.weather')),date:box(e.querySelector('.date')),city:box(e.querySelector('.city')),region:box(e.querySelector('.region'))})),reviews:[...document.querySelectorAll('.review-line')].map(e=>({w:e.clientWidth,sw:e.scrollWidth})),navHeight:document.querySelector('.quick-nav').getBoundingClientRect().height};
    })()`);
    assert.ok(report.scrollWidth<=report.width,'页面横向溢出');assert.equal(report.nav,expected.nav);assert.equal(report.selected,1);assert.equal(report.weather,expected.weather);assert.equal(report.stay,expected.stay);assert.equal(report.play,expected.play);
    for(const h of report.headers){assert.equal(h.text.h,68);assert.equal(h.weather.h,68);assert.equal(h.text.y,h.weather.y);assert.ok(h.date.y+h.date.h<=h.city.y+.5,'日期与城市重叠');assert.ok(h.city.y+h.city.h<=h.region.y+.5,'城市与地区重叠');assert.ok(h.city.x+h.city.w<=h.weather.x,'城市挤压天气');}
    for(const r of report.reviews)assert.ok(r.sw<=r.w,'口碑溢出');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,`preview-${width}.png`),Buffer.from(screenshot.data,'base64'));
    reports.push(report);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:url+'/long'});await delay(450);
  assert.ok(await evaluate(`(()=>{const c=document.querySelector('.long-name .city').getBoundingClientRect(),w=document.querySelector('.long-name .weather').getBoundingClientRect();return c.right<=w.left&&document.documentElement.scrollWidth<=innerWidth})()`),'长城市名挤压天气');
  await evaluate(`document.querySelector('.station').scrollIntoView({behavior:'instant',block:'start'})`);
  const longShot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(out,'long-city.png'),Buffer.from(longShot.data,'base64'));
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await send('Page.navigate',{url});await delay(450);
  await evaluate(`localStorage.clear();location.reload()`);await delay(450);
  const note=await evaluate(`(()=>{document.getElementById('note-trigger').click();const d=document.getElementById('checklist-dialog');const count=document.querySelectorAll('.checklist-item').length;const i=document.getElementById('checklist-input');i.value='<b>测试事项</b>';document.getElementById('checklist-form').requestSubmit();document.querySelector('.checklist-check').click();return {open:d.open,count,after:document.querySelectorAll('.checklist-item').length,markup:document.querySelectorAll('#checklist-list b').length}})()`);
  assert.deepEqual(note,{open:true,count:8,after:9,markup:0});
  await evaluate('location.reload()');await delay(450);
  const saved=await evaluate(`(()=>{document.getElementById('note-trigger').click();return {count:document.querySelectorAll('.checklist-item').length,checked:document.querySelector('.checklist-check').checked}})()`);assert.deepEqual(saved,{count:9,checked:true});
  await evaluate(`document.querySelector('.checklist-check').click(); document.querySelectorAll('.checklist-delete').forEach(b=>b.click())`);
  // Deleting re-renders the list, so use the current first button each time.
  await evaluate(`(()=>{let b;while(b=document.querySelector('.checklist-delete'))b.click()})()`);
  await evaluate('location.reload()');await delay(350);
  assert.equal(await evaluate(`document.querySelectorAll('.checklist-item').length`),0,'空清单被恢复为默认项');
  await evaluate(`localStorage.setItem('roadbook-town:checklist:v1:${trip.id}','invalid');location.reload()`);await delay(350);
  assert.equal(await evaluate(`document.querySelectorAll('.checklist-item').length`),8,'损坏存储未回退');
  const targetStop=trip.stops.at(-2).id;
  await evaluate(`document.querySelector('.checklist-close').click();document.querySelector('a[href="#stop-${targetStop}"]').click()`);await delay(1100);
  assert.equal(await evaluate(`document.querySelector('[aria-current="location"]').getAttribute('href')`),'#stop-'+targetStop);
  await evaluate('scrollTo(0,document.documentElement.scrollHeight)');await delay(600);assert.equal(await evaluate(`document.querySelector('[aria-current="location"]').getAttribute('href')`),'#stop-'+trip.stops.at(-1).id);
  await evaluate('scrollTo(0,0)');await delay(600);assert.equal(await evaluate(`document.querySelector('[aria-current="location"]').getAttribute('href')`),'#stop-'+trip.stops[0].id);
  const motion=[];for(let i=0;i<4;i++){motion.push(await evaluate(`document.querySelector('.route-car').style.transform`));await delay(440);}assert.ok(new Set(motion).size>1,'触控汽车动画没有多帧');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(450);
  const stationary=await evaluate(`document.querySelector('.route-car').style.transform`);await delay(600);assert.equal(await evaluate(`document.querySelector('.route-car').style.transform`),stationary);
  for(const codes of [[0,3,61],[71,45,95]]){weatherCodes=codes;await evaluate('location.reload()');await delay(350);const actual=await evaluate(`[...document.querySelectorAll('.weather-name')].slice(0,3).map(e=>e.textContent)`);assert.deepEqual(actual,codes[0]===0?['晴','阴','雨']:['雪','雾','雷雨']);}
  for(const mode of ['missing','stale','offline','timeout']){weatherMode=mode;await evaluate('location.reload()');await delay(mode==='timeout'?8500:450);const count=await evaluate(`document.querySelectorAll('.weather-error').length`);assert.equal(count,mode==='offline'||mode==='timeout'?expected.visit:1);assert.equal(await evaluate(`document.querySelectorAll('.spot-card').length`),expected.play);}
  await writeFile(join(out,'browser-report.json'),JSON.stringify({reports,note,saved,weatherCalls,motionFrames:new Set(motion).size,weatherFailureModes:['missing','stale','offline','timeout'],reducedMotion:true,scope:'Chrome模拟触控；不代表iOS真机验收'},null,2));
  console.log('360/390/430/1100px、天气成功/失败、导航、便利贴与触控动画检查通过。报告：output/qa/browser-report.json');
}finally{
  ws?.close();processChrome.kill();await new Promise(r=>server.close(r));
}
