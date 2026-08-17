/** Browser-only Markdown and source-preview rendering. Raw HTML stays disabled. */

/** Escapes text before it is inserted into a preview HTML string. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

const markdown = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight(source, language) {
    const name = String(language || '').trim().toLocaleLowerCase().split(/\s+/)[0];
    const hasLanguage = Boolean(name && window.hljs.getLanguage(name));
    const code = hasLanguage
      ? window.hljs.highlight(source, { language: name, ignoreIllegals: true }).value
      : window.hljs.highlightAuto(source).value;
    return `<pre class="hljs"><code${hasLanguage ? ` class="language-${escapeHtml(name)}"` : ''}>${code}</code></pre>`;
  }
});

/** Renders JSON or plain text as escaped, optionally syntax-highlighted source. */
function renderCodePreview(preview, source, language = '') {
  const hasLanguage = Boolean(language && window.hljs.getLanguage(language));
  const code = hasLanguage
    ? window.hljs.highlight(source, { language, ignoreIllegals: true }).value
    : escapeHtml(source);
  const languageClass = hasLanguage ? ` class="language-${escapeHtml(language)}"` : '';
  preview.innerHTML = `<pre class="hljs document-preview-code"><code${languageClass}>${code}</code></pre>`;
}

/** Renders Markdown, JSON, or plain text into the preview element. */
export function renderPreview(preview, type, source) {
  if (!source.trim()) {
    preview.innerHTML = '<div class="empty-preview"><strong>Your preview will appear here.</strong><span>Use the Markup helper for headings, lists, links, and code blocks.</span></div>';
    return;
  }
  if (type === 'json') return renderCodePreview(preview, source, 'json');
  if (type === 'text') return renderCodePreview(preview, source);
  preview.innerHTML = markdown.render(source);
}
