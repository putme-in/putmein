import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadWithProgress } from '../src/lib/upload-progress.ts';
class XHR {
 static last;
 upload = {};
 constructor() { XHR.last = this; }
 open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/api/deploy/upload'); }
 send() {}
 getResponseHeader() { return 'application/json'; }
 abort() { this.onabort(); }
}
test('transfer completion does not resolve before extraction response', async () => {
 const original = globalThis.XMLHttpRequest;
 globalThis.XMLHttpRequest = XHR;
 try {
  const updates = []; let sent = false, resolved = false;
  const pending = uploadWithProgress(new FormData(), (loaded, total) => updates.push([loaded, total]), () => { sent = true; }, new AbortController().signal).then(value => { resolved = true; return value; });
  const xhr = XHR.last;
  xhr.upload.onprogress({loaded: 50, total: 100, lengthComputable: true});
  xhr.upload.onload();
  await Promise.resolve();
  assert.equal(sent, true); assert.equal(resolved, false); assert.deepEqual(updates, [[50,100]]);
  xhr.status = 413; xhr.responseText = '{"error":"Too large"}'; xhr.onload();
  assert.equal((await pending).status, 413);
 } finally { globalThis.XMLHttpRequest = original; }
});
test('cancellation and network failure reject instead of hanging', async () => {
 const original = globalThis.XMLHttpRequest; globalThis.XMLHttpRequest = XHR;
 try {
  const controller = new AbortController();
  const cancelled = uploadWithProgress(new FormData(), () => {}, () => {}, controller.signal);
  controller.abort(); await assert.rejects(cancelled, {name:'AbortError'});
  const failed = uploadWithProgress(new FormData(), () => {}, () => {}, new AbortController().signal);
  XHR.last.onerror(); await assert.rejects(failed, /connection lost/);
 } finally { globalThis.XMLHttpRequest = original; }
});
