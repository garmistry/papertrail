'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Diagnostics } = require('../lib/diagnostics');

test('diagnostics persist bounded, single-line service logs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papertrail-diagnostics-'));
  const filePath = path.join(directory, 'papertrail.log');
  try {
    const diagnostics = new Diagnostics(filePath, 2);
    diagnostics.write('info', 'app', 'started');
    diagnostics.write('warn', 'updater', 'first line\nsecond line');
    diagnostics.write('error', 'updater', new Error('install failed'));

    assert.equal(diagnostics.list().length, 2);
    assert.match(diagnostics.list()[0], /\[WARN\] \[updater\] first line ↩ second line/);
    assert.match(new Diagnostics(filePath, 2).list()[1], /\[ERROR\] \[updater\].*install failed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
