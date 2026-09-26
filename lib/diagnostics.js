'use strict';

const fs = require('fs');
const path = require('path');

/** Keeps a bounded, persistent service log without adding a logging dependency. */
class Diagnostics {
  constructor(filePath, limit = 300) {
    this.filePath = filePath;
    this.limit = limit;
    this.entries = [];
    try {
      this.entries = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit);
      fs.writeFileSync(filePath, this.entries.length ? `${this.entries.join('\n')}\n` : '');
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Could not read diagnostics log:', error.message);
    }
  }

  /** Appends one single-line entry so logs remain readable and copyable. */
  write(level, service, ...values) {
    const message = values.map((value) => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' ').replace(/\s*\r?\n\s*/g, ' ↩ ');
    const entry = `${new Date().toISOString()} [${String(level).toUpperCase()}] [${service}] ${message}`;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${entry}\n`);
    } catch (error) {
      console.error('Could not write diagnostics log:', error.message);
    }
    return entry;
  }

  list() {
    return [...this.entries];
  }
}

module.exports = { Diagnostics };
