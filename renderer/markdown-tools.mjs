/** Selection-aware source edits used by Papertrail's Markdown helper. */

export const MARKDOWN_TOOLS = Object.freeze({
  'heading-1': { before: '# ', placeholder: 'Heading' },
  'heading-2': { before: '## ', placeholder: 'Heading' },
  bullets: { linePrefix: '- ', placeholder: 'List item' },
  numbered: { linePrefix: '1. ', placeholder: 'List item' },
  bold: { before: '**', after: '**', placeholder: 'bold text' },
  italic: { before: '*', after: '*', placeholder: 'italic text' },
  quote: { linePrefix: '> ', placeholder: 'Quoted text' },
  link: { before: '[', after: '](https://example.com)', placeholder: 'link text' },
  'inline-code': { before: '`', after: '`', placeholder: 'code' },
  'code-block': { before: '```text\n', after: '\n```', placeholder: 'code' },
  divider: { template: '\n---\n', select: false },
  table: { template: '| Column | Column |\n| --- | --- |\n| Value | Value |', placeholder: 'Column' }
});

/** Inserts a helper pattern into a textarea and selects the authored content when useful. */
export function applyMarkdownTool(editor, name) {
  const tool = MARKDOWN_TOOLS[name];
  if (!tool) return false;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const content = selected || tool.placeholder || '';
  const replacement = tool.template
    ? tool.template
    : tool.linePrefix && selected
      ? selected.split('\n').map((line) => `${tool.linePrefix}${line}`).join('\n')
      : `${tool.before || tool.linePrefix || ''}${content}${tool.after || ''}`;
  const selectedStart = start + (tool.before || tool.linePrefix || '').length;
  const selectedEnd = selected ? start + replacement.length - (tool.after || '').length : selectedStart + content.length;

  editor.setRangeText(replacement, start, end, 'select');
  if (tool.select !== false) editor.setSelectionRange(selectedStart, selectedEnd);
  return true;
}
