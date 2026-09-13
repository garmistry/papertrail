import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';

globalThis.window = {
  markdownit: (options) => new MarkdownIt(options),
  hljs: {
    getLanguage: () => false,
    highlightAuto: (source) => ({ value: source })
  }
};

const { renderPreview, replaceWebSequenceDiagram, stepDiagramZoom } = await import('../renderer/preview.mjs');

test('wsd fences render and inline edits replace only the selected diagram source', () => {
  const source = [
    '# Flow',
    '',
    '```wsd',
    'Client->Server: First',
    '```',
    '',
    '~~~wsd',
    'Server-->Client: Second',
    '~~~',
    ''
  ].join('\n');
  const preview = { innerHTML: '' };

  renderPreview(preview, 'markdown', source);
  assert.match(preview.innerHTML, /class="wsd-diagram"/);
  assert.match(preview.innerHTML, /class="wsd-expand"/);
  assert.match(preview.innerHTML, /cgi-bin\/cdraw\?s=modern-blue&amp;m=Client-%3EServer%3A%20First/);

  const updated = replaceWebSequenceDiagram(source, 1, 'Server-->Client: Updated');
  assert.match(updated, /Client->Server: First/);
  assert.match(updated, /~~~wsd\nServer-->Client: Updated\n~~~/);
  assert.equal(replaceWebSequenceDiagram(source, 2, 'missing'), null);
});

test('diagram zoom uses quarter steps within its supported range', () => {
  assert.equal(stepDiagramZoom(1, 1), 1.25);
  assert.equal(stepDiagramZoom(0.25, -1), 0.25);
  assert.equal(stepDiagramZoom(4, 1), 4);
});

test('Markdown headings generate a level-aware outline from the preview parse', () => {
  const source = '# Overview\n\nInstall now\n-----------\n\n#### API `v2` and *notes*\n';
  const preview = { innerHTML: '' };

  assert.deepEqual(renderPreview(preview, 'markdown', source), [
    { text: 'Overview', level: 1, offset: 0, previewIndex: 0 },
    { text: 'Install now', level: 2, offset: 12, previewIndex: 1 },
    { text: 'API v2 and notes', level: 4, offset: 37, previewIndex: 2 }
  ]);
});
