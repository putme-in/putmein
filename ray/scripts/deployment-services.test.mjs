import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
 const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
 const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
 const module = { exports: {} };
 new Function("require", "module", "exports", code)(id => Object.hasOwn(overrides,id) ? overrides[id] : require(id), module, module.exports);
 return module.exports;
}
const setup=load("project-setup",{"./framework-registry":load("framework-registry")});
test("older saved setup retains direct access and receives startup defaults",()=>{
 const parsed=setup.parseProjectSetup({version:1,sourceRoot:"/source",projectUrl:"https://external.example.com",dockerEnabled:false,startCommand:"npm start"});
 assert.equal(parsed.routingMode,"port");assert.deepEqual(parsed.healthCheck,{type:"http",path:"/",timeoutSeconds:60,intervalSeconds:2,successStatus:0});
});
test("managed HTTPS rejects unsafe origins and TCP service routing",()=>{
 for(const projectUrl of ["http://app.example.com","https://app.example.com:8443","https://app.example.com/path","https://app.example.com?x=y","https://user:pass@app.example.com","https://127.0.0.1","https://app.local","https://*.example.com"])assert.throws(()=>setup.parseProjectSetup({routingMode:"https",projectUrl}),projectUrl);
 assert.throws(()=>setup.parseProjectSetup({routingMode:"https",projectUrl:"https://app.example.com",healthCheck:{type:"tcp"}}));
 const parsed=setup.parseProjectSetup({routingMode:"https",projectUrl:"https://app.example.com",healthCheck:{path:"/ready",successStatus:204}});assert.equal(parsed.healthCheck.successStatus,204);
});
test("health settings reject remote probes, invalid statuses and unbounded timers",()=>{
 for(const healthCheck of [{path:"//evil.test"},{path:"http://evil.test"},{path:"/\r\n"},{timeoutSeconds:301},{intervalSeconds:0},{successStatus:500},{successStatus:100},{type:"exec"}])assert.throws(()=>setup.parseProjectSetup({healthCheck}));
 assert.equal(setup.parseProjectSetup({healthCheck:{type:"tcp",timeoutSeconds:300}}).healthCheck.type,"tcp");
});

test("mixed Python/frontend source uses the same framework for review and Brain payload", () => {
 const os=require('node:os'), path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ray-framework-handoff-'));
 try {
  fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({devDependencies:{eslint:'9.0.0'}}));
  fs.writeFileSync(path.join(root,'requirements.txt'), 'flask==3.0.0\n');
  const detection=load('framework-detection',{'./framework-registry':load('framework-registry')});
  const store=load('project-setup-store',{'server-only':{},'./project-setup':setup,'./project-source':load('project-source'),'./port-config':load('port-config'),'./framework-detection':detection});
  assert.equal(detection.detectFramework(root).slug,'flask');
  assert.equal(store.deploymentSetupPayload(setup.parseProjectSetup({sourceRoot:root})).framework,'flask');
  assert.equal(store.deploymentSetupPayload(setup.parseProjectSetup({sourceRoot:root,framework:'node',startCommand:'node server.js'})).framework,'node');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
