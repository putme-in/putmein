import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAddresses } from '../src/lib/live-addresses.ts';
test('direct port options preserve port and deduplicate addresses', () => {
 const links = liveAddresses('http://localhost:4050', ['192.168.1.20','192.168.1.20']);
 assert.equal(links.length, 3);
 assert.ok(links.some(l=>l.url==='http://192.168.1.20:4050/'));
 assert.ok(links.some(l=>l.url==='http://192-168-1-20.sslip.io:4050/'));
});
test('managed HTTPS does not invent exposed ports and unsafe URLs are rejected', () => {
 assert.equal(liveAddresses('https://app.example.com', ['192.168.1.20']).length,1);
 assert.deepEqual(liveAddresses('javascript:alert(1)'),[]);
 assert.deepEqual(liveAddresses('http://user:password@example.com:4050'),[]);
});
