import test from 'node:test';
import assert from 'node:assert/strict';
import { sameGitCommit } from '../src/lib/git-commit.ts';

test('polling recognizes full and historical short commit IDs', () => {
  const commit = 'd8950b27eaef10bdff72da894c8190a87a82a972';
  assert.equal(sameGitCommit(commit, commit), true);
  assert.equal(sameGitCommit(commit, commit.slice(0, 7)), true);
  assert.equal(sameGitCommit(commit, commit.toUpperCase()), true);
  assert.equal(sameGitCommit(commit, 'a'.repeat(40)), false);
  assert.equal(sameGitCommit(commit, 'latest'), false);
  assert.equal(sameGitCommit(commit, undefined), false);
  assert.equal(sameGitCommit(commit, commit.slice(0, 3)), false);
});

import ts from 'typescript';
import { readFileSync } from 'node:fs';
function loadRoute(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const auth = {
  'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-token' }) }) },
  '@/lib/auth': { verifyToken: async () => ({ userId: 'owner' }) },
};
test('poll does not retry failed commits or restart a long-running attempt', async () => {
  const commit = 'd8950b27eaef10bdff72da894c8190a87a82a972';
  for (const run of [
    { status: 'failed', commitHash: commit },
    { status: 'failed', commitHash: commit.slice(0, 7) },
    { status: 'running', commitHash: 'a'.repeat(40), createdAt: new Date(0) },
  ]) {
    const route = loadRoute('../app/api/cicd/poll/route.ts', {
      ...auth,
      fs: { existsSync: () => true },
      '@/lib/git-commit': { sameGitCommit },
      '@/lib/git-source': { cloneGitSource: async () => ({ commitHash: commit }) },
      '@/lib/prisma': {
        rayMonitorProject: { findMany: async () => [{ name: 'app', projectPath: '/fixture' }] },
        rayPipeline: { findMany: async () => [{ id: 'pipe', name: 'app', branch: 'main', repoUrl: 'https://example.com/app', runs: [run] }] },
        $transaction: () => { throw new Error('Should not create another run'); },
      },
    });
    assert.deepEqual((await route.POST({})).body.triggered, []);
  }
});
test('security diagnosis uses owned report findings without calling AI', async () => {
  let lookup;
  const route = loadRoute('../app/api/deployments/[id]/diagnose/route.ts', {
    ...auth,
    '@/lib/prisma': {
      rayDeployment: { findFirst: async () => null },
      raySecurityScan: { findFirst: async query => { lookup = query; return { dangerCount: 1, warnCount: 0, findings: JSON.stringify([{ title: 'Credential pattern', file: '.env.example', line: 89, severity: 'danger' }]) }; } },
    },
  });
  const result = await route.POST({ json: async () => ({ logs: 'security gate blocked deployment; review scan scan_12345' }) }, { params: Promise.resolve({ id: 'adhoc' }) });
  assert.deepEqual(lookup.where, { id: 'scan_12345', userId: 'owner' });
  assert.equal(result.body.diagnosis.canAutoFix, false);
  assert.equal(result.body.diagnosis.securityScanId, 'scan_12345');
  assert.match(result.body.diagnosis.fixSteps[0], /\.env.example:89/);
});
