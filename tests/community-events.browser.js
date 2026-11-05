'use strict';
/* Read-only local review. All non-local traffic is intercepted; no real registration,
   organizer visits, analytics, signup, credentials, deployment or publication. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { FEED_URL, NOW, root, fixturePath, realFeed, fixtureHash, event, feed, manyEvents, expectedIds } = require('./events-fixtures');
const engine = process.env.BROWSER || 'chromium';
const output = path.join(root, 'test-results');
const section = '[data-fep-events]';
const cards = section + ' [data-event-grid] [data-event-id]';
const gathers = '[data-gatherings]';
const results = [], failures = [], baselineAxe = [];
const viewports = [{width:320,height:740},{width:390,height:844},{width:1440,height:1000}];
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server = http.createServer((request, response) => {
  if (!['GET','HEAD'].includes(request.method)) return response.writeHead(405).end();
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__cors-feed') { response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(feed())); return; }
    if (pathname === '/') pathname = '/index.html';
    const target = path.resolve(root, '.' + pathname);
    if (!target.startsWith(root + path.sep) || pathname.split('/').some(part => part.startsWith('.'))) return response.writeHead(404).end();
    response.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream'}).end(fs.readFileSync(target));
  } catch (_) { response.writeHead(404).end(); }
});
let browser, origin;
const ids = page => page.locator(cards).evaluateAll(nodes => nodes.map(node => node.dataset.eventId));
const visibleGatherings = page => page.locator(gathers + ' [data-gathering-id]:visible');
async function count(page, number) { await page.waitForFunction(({selector,number}) => document.querySelectorAll(selector).length === number, {selector:cards,number}); assert.equal(await page.locator(cards).count(), number); }
async function settled(page) { await page.waitForFunction(selector => { const node=document.querySelector(selector); return node && node.dataset.signature !== undefined; }, section+' [data-event-grid]'); }
async function fallback(page) {
  const link = page.locator(section + ' a[href="https://findeverypark.com/events.html"]').first();
  assert.ok(await link.isVisible(), 'Static FindEveryPark fallback is available');
  assert.ok((await link.textContent()).trim());
}
async function newPage({data = feed(), viewport = viewports[1], mode = 'ok', now = NOW, javaScriptEnabled = true, timeZone = 'America/Denver', transformHTML = null, fixedTime = false} = {}) {
  const context = await browser.newContext({viewport, timezoneId:timeZone, javaScriptEnabled});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const unexpected = [], errors = [], requests = [];
  let currentData = data, currentMode = mode, hits = 0; const pendingResponses = [];
  await context.addCookies([{name:'review-only-sentinel',value:'not-a-real-cookie',domain:'findeverypark.com',path:'/',secure:true,sameSite:'None'}]);
  page.on('pageerror', error => errors.push(error.message));
  if (javaScriptEnabled) {
    await page.clock.install({time:new Date(now)});
    // Exact-boundary scenarios must not drift across end−1ms during navigation.
    if(fixedTime) await page.clock.setFixedTime(new Date(now));
  }
  await context.route('**/*', async route => {
    const request = route.request(); const url = request.url();
    requests.push({url,method:request.method(),type:request.resourceType()});
    if (new URL(url).origin === origin && ['GET','HEAD'].includes(request.method())) {
      if(transformHTML && new URL(url).pathname === '/events.html') return route.fulfill({contentType:'text/html',body:transformHTML(fs.readFileSync(path.join(root,'events.html'),'utf8'))});
      return route.continue();
    }
    if (url !== FEED_URL || request.method() !== 'GET') { unexpected.push(url); return route.abort('blockedbyclient'); }
    if(request.headers().cookie) unexpected.push('Feed request disclosed a cookie');
    if(request.headers().referer) unexpected.push('Feed request disclosed the page URL');
    hits++;
    if (currentMode === 'network') return route.abort('failed');
    if (currentMode === 'cors') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'https://not-mighty-dads.invalid'},body:JSON.stringify(currentData)});
    if (currentMode === 'delayed') await new Promise(resolve=>pendingResponses.push(resolve));
    if (currentMode === 'timeout') return; // AbortController must terminate this outstanding fetch.
    if (currentMode === '404') return route.fulfill({status:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});
    if (currentMode === 'malformed') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{not-json'});
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(currentData)});
  });
  return {page, context, unexpected, errors, requests, hits:()=>hits, release:()=>pendingResponses.splice(0).forEach(resolve=>resolve()), change:(nextData,nextMode='ok')=>{currentData=nextData;currentMode=nextMode;}};
}
async function run(name, fn) {
  try { await fn(); results.push(name); console.log('PASS', name); }
  catch(error) { failures.push({name,error:error.stack}); console.error('FAIL',name,error.stack); }
}
async function using(options, fn) {
  const env=await newPage(options);
  try {
    await fn(env);
    assert.deepEqual(env.unexpected, [], 'No external scripts, organizers, signup or analytics requests');
    // WebKit reports its expected browser-level CORS rejection as pageerror even
    // though the application catches fetch rejection and displays the fallback.
    const runtimeErrors=env.errors.filter(message=>!(engine==='webkit' && options.mode==='cors' && /^\/findeverypark\.com\/data\/events\/community-feed\.v1\.json due to access control checks\.$/.test(message)));
    assert.deepEqual(runtimeErrors, [], 'No uncaught JavaScript errors');
  }
  catch(error) { try { await env.page.screenshot({path:path.join(output,engine+'-failure-'+(failures.length+1)+'.png'),fullPage:true}); } catch(_) {} throw error; }
  finally { await env.context.close(); }
}
async function refresh(page) {
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
}
async function layoutBounds(page, width, selector) {
  const bounds=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,scroll:node.scrollWidth,client:node.clientWidth})));
  for(const box of bounds) { assert.ok(box.left>=-1&&box.right<=width+1, JSON.stringify(box)); assert.ok(box.scroll<=box.client+1,JSON.stringify(box)); }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'No horizontal page overflow');
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const originalHash = fixtureHash(), real = realFeed();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  if(!['chromium','webkit'].includes(engine)) throw new Error('BROWSER must be chromium or webkit');
  const launch={headless:true};
  if(engine==='chromium'&&process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;
  browser=await({chromium,webkit})[engine].launch(launch);
  for(const viewport of viewports) {
    for(const [file,limit] of [['index.html',3],['events.html',5]]) {
      await run(`${viewport.width}: ${file} real candidate, card limits, source copy, responsive layout and accessibility`,()=>using({data:real,viewport,timeZone:viewport.width===1440?'Asia/Tokyo':viewport.width===320?'America/Los_Angeles':'America/Denver'},async({page,requests})=>{
        await page.goto(origin+'/'+file); await settled(page); await fallback(page);
        assert.deepEqual(await ids(page),expectedIds(real,limit));
        assert.equal(await page.locator(section).getAttribute('data-limit'),String(limit));
        for(const id of await ids(page)) {
          const source=real.events.find(item=>item.id===id);
          const target=page.locator('[data-event-id='+JSON.stringify(id)+']');
          const copy=await target.textContent();
          for(const key of ['title','dateLabel','locationLabel','costLabel','registrationLabel','availabilityLabel']) if(source[key]) assert.ok(copy.includes(source[key]),id+': '+key);
          const links=await target.locator('a').evaluateAll(nodes=>nodes.map(node=>({href:node.href,target:node.target,rel:node.rel})));
          assert.ok(links.length>0); for(const link of links){ assert.equal(link.href,new URL(source.href).href); assert.ok(['https:','http:'].includes(new URL(link.href).protocol)); if(link.target==='_blank') assert.match(link.rel,/noopener/); }
        }
        await layoutBounds(page,viewport.width,cards);
        const axe=await new AxeBuilder({page}).include(section).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        fs.writeFileSync(path.join(output,`${engine}-${file}-axe-${viewport.width}.json`),JSON.stringify(axe.violations,null,2));
        assert.deepEqual(axe.violations.map(item=>({id:item.id,nodes:item.nodes.length})),[]);
        await page.locator(section).screenshot({path:path.join(output,`${engine}-${file}-community-${viewport.width}.png`)});
        if(file==='events.html') {
          assert.equal(await visibleGatherings(page).count(),2);
          await layoutBounds(page,viewport.width,gathers+' [data-gathering-id]');
          const gatheringAxe=await new AxeBuilder({page}).include(gathers).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
          assert.deepEqual(gatheringAxe.violations.map(item=>({id:item.id,nodes:item.nodes.length})),[]);
          await page.locator(gathers).screenshot({path:path.join(output,`${engine}-gatherings-${viewport.width}.png`)});
        }
        await page.screenshot({path:path.join(output,`${engine}-${file}-full-${viewport.width}.png`),fullPage:true});
        const full=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        baselineAxe.push({page:file,width:viewport.width,violations:full.violations});
        assert.equal(requests.filter(request=>request.url===FEED_URL).length,1);
      }));
    }
  }
  await run('synthetic feed sorts, deduplicates and caps homepage at three / Events at five',()=>using({data:feed([...manyEvents().reverse(),manyEvents()[0]])},async({page})=>{
    for(const [file,limit] of [['index.html',3],['events.html',5]]) {await page.goto(origin+'/'+file);await count(page,limit);assert.deepEqual(await ids(page),manyEvents().slice(0,limit).map(item=>item.id));}
  }));
  await run('fewer events and empty results preserve reliable fallback',()=>using({data:feed(manyEvents(2))},async({page,change})=>{
    await page.goto(origin+'/events.html'); await count(page,2); await fallback(page);
    change(feed([])); await page.reload();await settled(page);await count(page,0);await fallback(page);
    assert.match(await page.locator('[data-feed-status]').textContent(),/no |nothing|check|browse/i);
  }));
  await run('malformed entries are omitted individually, remaining events stay usable',()=>using({data:feed([event('good'),null,{},event('no-title',{title:''}),event('no-id',{id:''}),event('bad-expiry',{expiresAt:'tomorrow'}),event('expired',{expiresAt:NOW}),event('bad-date',{dateStart:'not-a-date',sortAt:'not-a-date'})])},async({page})=>{
    await page.goto(origin+'/events.html');await settled(page);assert.deepEqual(await ids(page),['good']);await fallback(page);
  }));
  for(const data of [null,{},[],feed([],{schemaVersion:2}),feed([],{timeZone:'America/New_York'}),feed([],{events:'not-an-array'})]) {
    await run('invalid feed envelope fails closed: '+JSON.stringify(data),()=>using({data},async({page})=>{await page.goto(origin+'/events.html');await settled(page);await count(page,0);await fallback(page);}));
  }
  for(const mode of ['404','malformed','network','cors','timeout']) {
    await run(mode+' failure keeps fallback and announces unavailable data',()=>using({mode},async({page})=>{
      await page.goto(origin+'/events.html');if(mode==='timeout')await page.clock.fastForward(20000);await settled(page);await count(page,0);await fallback(page);
      assert.match(await page.locator('[data-feed-status]').textContent(),/unavailable|couldn.t|unable|load|try|check|browse/i);
    }));
  }
  await run('source titles and descriptions are text, unsafe URLs cannot become links',()=>using({data:feed([
    event('safe-text',{title:'<img src=x onerror="window.__injected=1">',description:'<script>window.__injected=2</script> & review text'}),
    ...['javascript:alert(1)','data:text/html,test','vbscript:msgbox(1)','file:///tmp/test','//evil.invalid','https://evil@findeverypark.com/events.html'].map((href,index)=>event('unsafe-'+index,{href}))
  ])},async({page})=>{
    await page.goto(origin+'/events.html');await settled(page);assert.deepEqual(await ids(page),['safe-text']);
    assert.equal(await page.locator(cards+' img, '+cards+' script').count(),0);
    assert.ok((await page.locator(cards).textContent()).includes('<img src=x onerror="window.__injected=1">'));
    assert.equal(await page.evaluate(()=>window.__injected),undefined);await fallback(page);
  }));
  await run('missing-organizer source fallback is labeled as the FindEveryPark calendar',()=>using({data:feed([event('source-fallback',{href:'https://findeverypark.com/events.html'})])},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);const source=page.locator(cards+' a');
    assert.equal(await source.textContent(),'FindEveryPark calendar');assert.equal(await source.getAttribute('href'),'https://findeverypark.com/events.html');
    assert.doesNotMatch(await source.getAttribute('aria-label') || '',/Organizer details/);
  }));
  await run('long unbroken feed text fits the narrowest viewport',()=>using({viewport:viewports[0],data:feed([event('long-text',{title:'X'.repeat(120),description:'Y'.repeat(240)})])},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);await layoutBounds(page,320,cards);
  }));
  await run('exact timed expiry works before/at end and in an already open page',()=>using({data:feed([event('timed',{expiresAt:'2026-11-05T12:01:00.000Z',dateEnd:'2026-11-05T12:01:00.000Z',dateStart:'2026-11-05T11:00:00.000Z',sortAt:'2026-11-05T11:00:00.000Z'})]),now:'2026-11-05T12:00:59.999Z',fixedTime:true},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);
    await page.clock.setFixedTime(new Date('2026-11-05T12:01:00.000Z'));await page.clock.fastForward(60001);await count(page,0);await fallback(page);
    await page.reload();await settled(page);await count(page,0);
  }));
  await run('date-only expiry is next Mountain midnight, independent of viewer timezone',()=>using({data:feed([event('date-only',{dateStart:'2026-11-20',dateEnd:'',sortAt:'2026-11-20T07:00:00.000Z',expiresAt:'2026-11-21T07:00:00.000Z',timeLabel:'Time not published'})]),now:'2026-11-21T06:59:59.999Z',fixedTime:true,timeZone:'Asia/Tokyo'},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);
    await page.clock.setFixedTime(new Date('2026-11-21T07:00:00.000Z'));await refresh(page);await count(page,0);await fallback(page);
  }));
  await run('return-tab expiry removes stale cards without requiring navigation',()=>using({data:feed([event('tab-return')])},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);const before=page.url();
    await page.clock.setFixedTime(new Date('2026-11-07T12:00:00.000Z'));await refresh(page);await count(page,0);assert.equal(page.url(),before);
  }));
  await run('successful refresh preserves keyboard focus and disclosure state',()=>using({data:feed(manyEvents(2))},async({page,change,hits})=>{
    await page.goto(origin+'/events.html');await count(page,2);
    const first=page.locator(cards).first();const summary=first.locator('summary');assert.equal(await summary.count(),1,'Accessible details disclosure');
    await summary.focus();await page.keyboard.press('Enter');assert.ok(await first.locator('details').evaluate(node=>node.open));
    await page.keyboard.press('Tab');assert.ok(await first.locator('a').evaluateAll(nodes=>nodes.includes(document.activeElement)),'Source link is keyboard reachable after disclosure');
    const focused=await page.evaluate(()=>document.activeElement.href);const originalUrl=page.url();
    change(feed(manyEvents(2).map(item=>({...item,availabilityLabel:'Confirm availability before attending'}))));
    const before=hits();await page.clock.fastForward(10*60000+1);await refresh(page);await page.waitForFunction(()=>document.body.textContent.includes('Confirm availability before attending'));
    assert.ok(hits()>before);assert.equal(await page.evaluate(()=>document.activeElement.href),focused);assert.ok(await first.locator('details').evaluate(node=>node.open));assert.equal(page.url(),originalUrl);
    const style=await page.evaluate(()=>{const node=document.activeElement,s=getComputedStyle(node);return {outline:s.outlineStyle,width:s.outlineWidth,shadow:s.boxShadow};});
    assert.ok((style.outline!=='none'&&parseFloat(style.width)>0)||style.shadow!=='none','Visible keyboard focus indicator');
  }));
  await run('forced refresh failure clears previously rendered cards',()=>using({data:feed(manyEvents(2))},async({page,change,hits})=>{
    await page.goto(origin+'/events.html');await count(page,2);change(null,'network');const before=hits();
    await page.clock.fastForward(10*60000+1);await refresh(page);await count(page,0);assert.ok(hits()>before);await fallback(page);
  }));
  await run('retry success moves keyboard focus away from a now-hidden retry button',()=>using({mode:'network'},async({page,change,release,hits})=>{
    await page.goto(origin+'/events.html');await settled(page);const retry=page.locator('[data-feed-retry]');assert.ok(await retry.isVisible());await retry.focus();change(feed(),'delayed');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-feed-retry]').getAttribute('aria-disabled')==='true');
    assert.ok(await retry.evaluate(node=>node===document.activeElement),'Focus survives a delayed request');const attempts=hits();await page.keyboard.press('Enter');assert.equal(hits(),attempts,'Repeated activation must not duplicate a pending fetch');release();await count(page,1);
    assert.ok(await retry.isHidden());assert.notEqual(await page.evaluate(()=>document.activeElement.hasAttribute('data-feed-retry')),true);
    assert.ok(await page.evaluate(()=>document.activeElement!==document.body&&document.activeElement.getBoundingClientRect().height>0),'Focus stays on a visible useful target');
  }));
  await run('expiry moves focus out of a removed event into the section heading',()=>using({data:feed([event('focused-expiry')])},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);await page.locator(cards+' a').focus();await page.clock.setFixedTime(new Date('2026-11-07T12:00:00Z'));await refresh(page);await count(page,0);
    assert.equal(await page.evaluate(()=>document.activeElement.tagName),'H2');await fallback(page);
  }));
  await run('normal minute update retains open disclosure and keyboard focus',()=>using({data:feed()},async({page})=>{
    await page.goto(origin+'/events.html');await count(page,1);const summary=page.locator(cards+' summary');await summary.focus();await page.keyboard.press('Enter');await page.clock.fastForward(60001);
    assert.ok(await page.locator(cards+' details').evaluate(node=>node.open));assert.ok(await summary.evaluate(node=>node===document.activeElement));
  }));
  for(const broken of ['{}','null','[null]','{not-json']) {
    await run('malformed gatherings JSON does not prevent community data: '+broken,()=>using({transformHTML:html=>html.replace(/(<script type="application\/json" id="gatherings-data">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+broken+end)},async({page})=>{
      await page.goto(origin+'/events.html');await count(page,1);await fallback(page);assert.equal(await visibleGatherings(page).count(),0);
    }));
  }
  await run('gatherings show only approved dates and titles without invented event times',()=>using({},async({page})=>{
    await page.goto(origin+'/events.html');await settled(page);assert.equal(await visibleGatherings(page).count(),2);
    const text=await page.locator(gathers).textContent();assert.match(text,/Poker Night/);assert.match(text,/Christmas Party/);assert.match(text,/November 20/);assert.match(text,/December 19/);
    assert.match(text,/Mountain/);assert.match(text,/not yet confirmed|to be announced/i);
    assert.equal(await page.locator(gathers+' a[href*="calendar"], '+gathers+' a[href*="mailto"], '+gathers+' a[href*="rsvp"]').count(),0);
    const privateDetail=await visibleGatherings(page).allTextContents();assert.doesNotMatch(privateDetail.join(' '),/\b(?:[1-9]|1[0-2])(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\$\d|\bages?\s+\d|\b\d{2,5}\s+[A-Za-z]+\s+(?:Street|St\.|Avenue|Ave\.|Drive|Dr\.|Road|Rd\.)\b/i);
  }));
  for(const [boundary,remaining] of [['2026-11-21T07:00:00.000Z',1],['2026-12-20T07:00:00.000Z',0]]) {
    await run('gathering date-only expiry at '+boundary,()=>using({now:new Date(Date.parse(boundary)-1).toISOString(),fixedTime:true,timeZone:'Pacific/Auckland'},async({page})=>{
      await page.goto(origin+'/events.html');await settled(page);assert.equal(await visibleGatherings(page).count(),remaining+1);
      await page.clock.setFixedTime(new Date(boundary));await page.clock.fastForward(60001);assert.equal(await visibleGatherings(page).count(),remaining);
    }));
  }
  await run('JavaScript-disabled pages preserve static source fallback without stale event cards',()=>using({javaScriptEnabled:false},async({page,hits})=>{
    for(const file of ['index.html','events.html']) {await page.goto(origin+'/'+file);await fallback(page);assert.equal(await page.locator(cards).count(),0);}
    assert.equal(hits(),0);
  }));
  await run('candidate source is unchanged after every browser scenario',async()=>assert.equal(fixtureHash(),originalHash));
})().catch(error=>{failures.push({name:'suite setup',error:error.stack});console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();server.close();
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,engine+'-full-page-axe.json'),JSON.stringify(baselineAxe,null,2));
  fs.writeFileSync(path.join(output,engine+'-community-events-results.json'),JSON.stringify({engine,fixturePath,results,failures},null,2));
  console.log(`${results.length} passed, ${failures.length} failed`);if(failures.length)process.exitCode=1;
});
