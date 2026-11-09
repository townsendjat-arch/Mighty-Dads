const { chromium, webkit } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname)); if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;} fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(data);});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const base=`http://127.0.0.1:${server.address().port}`; fs.mkdirSync(path.join(root,'test-results'),{recursive:true});let checks=0;
 try {for(const [name,type] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.env.BROWSER || process.env.BROWSER===name)) {
  const browser=await type.launch(name==='chromium' && process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{});
  try {for(const width of [320,390,1280]) {
   const page=await browser.newPage({viewport:{width,height:900}});const external=[];page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
   await page.goto(base+'/events.html');await page.locator('.gathering-flyer').scrollIntoViewIfNeeded();await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));
   assert.equal(await page.locator('#gatherings article').count(),2);checks++;
   assert.equal(await page.locator('#gathering-request :is(input,select,textarea)').count(),5);assert.equal(await page.locator('#gathering-request :is(input,select,textarea):disabled').count(),5);checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
   const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(results.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);checks++;
   // Even programmatic form submission cannot transmit; CSP blocks it.
   await page.evaluate(()=>document.querySelector('form').requestSubmit());await page.waitForTimeout(100);assert.equal(page.url(),base+'/events.html');assert.deepEqual(external,[]);checks++;
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);checks++;
   await page.locator('#gatherings').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,`test-results/${name}-${width}.png`),fullPage:true});
   await page.goto(base+'/index.html');await page.getByRole('link',{name:'See gathering details'}).click();assert.equal(new URL(page.url()).hash,'#gatherings');await page.goBack();assert.match(page.url(),/index.html$/);checks++;
   const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900}});const p=await nojs.newPage();await p.goto(base+'/events.html');assert.equal(await p.locator('#gathering-request input:disabled').count(),3);checks++;await nojs.close();await page.close();
   console.log(`PASS ${name} ${width}px: layout, cards, disabled form, axe, blocked submit, no storage, navigation, no JS`);
  }}finally{await browser.close();}
 } console.log(`PASS ${checks} browser checks`);
 }finally{server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
