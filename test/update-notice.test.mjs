import assert from 'node:assert/strict';
import test from 'node:test';
import { updateNoticeView } from '../renderer/update-notice.mjs';

test('update notices expose only actions valid for the current updater state', () => {
  assert.equal(updateNoticeView({ state: 'idle' }), null);
  assert.equal(updateNoticeView({ state: 'available', version: '1.2.0' }).action, 'Download');
  assert.deepEqual(updateNoticeView({ state: 'downloading', percent: 140 }), {
    title: 'Downloading update', message: '100% complete', action: null, progress: 100
  });
  assert.equal(updateNoticeView({ state: 'downloaded', version: '1.2.0' }).action, 'Restart & Install');
  assert.equal(updateNoticeView({ state: 'error' }).action, 'Retry');
});
