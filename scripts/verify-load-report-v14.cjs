'use strict';
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/杜铠羽/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=path.resolve(__dirname,'../workspace-artifacts/load-test-20261003-v14');
async function run(){
 const report={startedAt:new Date().toISOString(),productionRequests:0,pageErrors:[],externalRequests:[],views:[],ok:false};
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith('file:')||url.startsWith('data:'))return route.continue();report.externalRequests.push(url);return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(output,'report.html')).href,{waitUntil:'load'});
  report.title=await page.title();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   const view=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,heading:document.querySelector('h1')?.innerText,sections:[...document.querySelectorAll('h2')].map(x=>x.innerText),hasSnapshotMarker:/报告状态：snapshot/.test(document.body.innerText)}));
   if(view.scrollWidth>width+1||view.bodyWidth>width+1||view.hasSnapshotMarker||!/v14/.test(view.heading))throw Error('Report layout or completion marker invalid');
   report.views.push(view);
   if(width===1440)await page.screenshot({path:path.join(output,'report-preview.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const local=page.locator('section').filter({has:page.locator('h2',{hasText:/本地/})});
  if(await local.count()!==1)throw Error('Final local decoder section missing');
  await local.screenshot({path:path.join(output,'report-local-decoder-preview.png')});
  if(report.pageErrors.length||report.externalRequests.length)throw Error('Unexpected report external activity');
  report.ok=true;
 }finally{
  await browser?.close();report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report-render-verification.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify({ok:report.ok,views:report.views.length,externalRequests:report.externalRequests.length,pageErrors:report.pageErrors.length}));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
