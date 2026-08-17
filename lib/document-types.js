'use strict';

const path = require('path');

const DOCUMENT_FILTERS = [{ name: 'Markdown, text, and JSON', extensions: ['md', 'markdown', 'mdx', 'txt', 'json'] }];
const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.json']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

/** Returns the normalized extension for a document path. */
function extensionFor(filePath) {
  return path.extname(String(filePath || '')).toLocaleLowerCase();
}

/** Identifies whether a path is one of Papertrail's supported document types. */
function isSupportedDocumentPath(filePath) {
  return DOCUMENT_EXTENSIONS.has(extensionFor(filePath));
}

/** Identifies Markdown files for the global Markdown-open metric. */
function isMarkdownPath(filePath) {
  return MARKDOWN_EXTENSIONS.has(extensionFor(filePath));
}

/** Selects the renderer preview mode for a supported document path. */
function documentTypeFor(filePath) {
  const extension = extensionFor(filePath);
  return extension === '.json' ? 'json' : extension === '.txt' ? 'text' : 'markdown';
}

/** Finds the first supported document path passed to the application. */
function documentPathFrom(argv) {
  return Array.isArray(argv) ? argv.find(isSupportedDocumentPath) : undefined;
}

module.exports = { DOCUMENT_FILTERS, documentPathFrom, documentTypeFor, isMarkdownPath };
