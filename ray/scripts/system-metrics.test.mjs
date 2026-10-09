import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = (await fs.readFile(new URL('../src/lib/system-metrics.ts', import.meta.url), 'utf8')).replace('import "server-only";', '');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { cpuUtilization, linuxAvailableMemory, getSystemMetrics } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const counter = (user, idle) => ({ times: { user, idle, nice: 0, sys: 0, irq: 0 } });
test('CPU measures counter deltas, not lifetime totals or load averages', () => {
 assert.equal(cpuUtilization([counter(500,500)], [counter(525,575)]),25);
 assert.equal(cpuUtilization([counter(0,0)], [counter(0,100)]),0);
 assert.equal(cpuUtilization([counter(0,0)], [counter(100,0)]),100);
 assert.equal(cpuUtilization([counter(0,0),counter(0,0)], [counter(100,0),counter(0,100)]),50);
});
test('invalid, unchanged and hotplugged CPU samples are unavailable', () => {
 assert.equal(cpuUtilization([],[]),null);
 assert.equal(cpuUtilization([counter(5,5)],[counter(5,5)]),null);
 assert.equal(cpuUtilization([counter(5,5)],[counter(1,5)]),null);
 assert.equal(cpuUtilization([counter(5,5)],[]),null);
});
test('Linux available memory includes reclaimable cache and validates units/bounds', () => {
 assert.equal(linuxAvailableMemory('MemFree: 10 kB\nMemAvailable:  750 kB\n',1024*1000),750*1024);
 assert.equal(linuxAvailableMemory('MemFree: 10 kB',1024*1000),null);
 assert.equal(linuxAvailableMemory('MemAvailable: 2000 kB',1024*1000),null);
});
test('local collection returns bounded measurements and shares concurrent samples', async () => {
 const [a,b] = await Promise.all([getSystemMetrics(),getSystemMetrics()]);
 assert.equal(a,b);
 for (const key of ['cpu','memory','disk']) assert.ok(a[key] === null || (a[key]>=0 && a[key]<=100));
 assert.ok(a.name);
 assert.ok(Date.parse(a.sampledAt));
 assert.equal(await getSystemMetrics(),a);
});
