import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanChecklist } from '../src/lib/plan-checklist.ts';
test('only tasks become checkboxes; formatting and completion survive', () => {
  const items = parsePlanChecklist('### Objective\nDeploy app\n### Checklist\n- [x] **Read** source\n- [ ] Review `port`\n### Commands\n1. Build it\n```md\n- [ ] example only\n```');
  assert.equal(items.length, 2);
  assert.equal(items[0].completed, true);
  assert.equal(items[0].text, '**Read** source');
  assert.equal(items[1].completed, false);
});
test('accepts uppercase and numbered tasks without inventing tasks from prose', () => {
  assert.deepEqual(parsePlanChecklist('  * [X] Done\n1. [ ] Next\nordinary text').map(i => i.completed), [true, false]);
  assert.deepEqual(parsePlanChecklist('### Notes\nNo checklist'), []);
});
