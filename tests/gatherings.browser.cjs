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
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const external=[];page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
   await page.goto(base+'/events.html');await page.locator('.gathering-flyer').scrollIntoViewIfNeeded();await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));
   assert.equal(await page.locator('#gatherings article').count(),2);checks++;
   assert.equal(await page.locator('#gathering-request :is(input,select,textarea)').count(),5);assert.equal(await page.locator('#gathering-request :is(input,select,textarea):disabled').count(),5);checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
   const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(results.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);checks++;
   // Even programmatic form submission cannot transmit; CSP blocks it.
   await page.evaluate(()=>{window.blockedSubmission=false;document.addEventListener('securitypolicyviolation',e=>{if(e.violatedDirective==='form-action')window.blockedSubmission=true;});document.querySelector('form').requestSubmit();});await page.waitForFunction(()=>window.blockedSubmission===true);assert.equal(page.url(),base+'/events.html');assert.deepEqual(external,[]);checks++;
   // Exercise the prepared adapter with injected in-memory responses only.
   await page.addScriptTag({content:fs.readFileSync(path.join(root,'assets/js/gatherings-rsvp.js'),'utf8')});
   const adapter = await page.evaluate(async()=>{
    const api=window.GatheringsRSVP;
    const input={event:'poker-2026',name:'Test Adult',email:'test@example.invalid',guests:'2',message:''};
    let calls=0; const transport=async()=>{calls++;return {ok:true,json:async()=>({ok:true})};};
    const disabled=await api.createClient({transport})(input,'test');
    const before=calls;
    const settings={...api.config,enabled:true};const now=()=>Date.parse('2026-11-09T12:00:00-07:00');
    const submit=api.createClient({settings,transport,now});
    const invalid=await submit({...input,email:'invalid'},'test');
    const captcha=await submit(input);
    const success=await submit(input,'synthetic-token');
    const failure=await api.createClient({settings,now,transport:async()=>({ok:false,status:429})})(input,'test');
    return {disabled:disabled.state,before,invalid:invalid.state,captcha:captcha.state,success:success.state,message:success.message,failure:failure.state,calls};
   });
   assert.deepEqual(adapter,{disabled:'disabled',before:0,invalid:'invalid',captcha:'invalid',success:'success',message:'Request received; attendance is not confirmed. An organizer will review your request. No location is included in this receipt.',failure:'error',calls:1});assert.deepEqual(external,[]);checks++;
   // Clear the browser's canceled navigation state after the CSP probe.
   await page.goto(base+'/events.html');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);checks++;
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);await page.screenshot({path:path.join(root,`test-results/${name}-${width}.png`),fullPage:true});
   await page.goto(base+'/index.html');await page.getByRole('link',{name:'See gathering details'}).click();assert.equal(new URL(page.url()).hash,'#gatherings');await page.goBack();assert.match(page.url(),/index.html$/);checks++;
   const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900}});const p=await nojs.newPage();await p.goto(base+'/events.html');assert.equal(await p.locator('#gathering-request input:disabled').count(),3);checks++;await nojs.close();await context.close();
   console.log(`PASS ${name} ${width}px: layout, cards, disabled form, axe, blocked submit, no storage, navigation, no JS`);
  }}finally{await browser.close();}
 } console.log(`PASS ${checks} browser checks`);
 }finally{server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
