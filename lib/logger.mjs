import fs from 'fs/promises';
import path from 'path';

class Logger {
  constructor(config) {
    this.level = config.logging.level;
    this.console = config.logging.console;
    this.file = config.logging.file;
    this.logDir = config.logging.logDir || null;
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
  }

  async init() {
    if (this.file && this.logDir) {
      await fs.mkdir(this.logDir, { recursive: true });
    }
  }

  async log(level, message, meta = {}) {
    if (this.levels[level] < this.levels[this.level]) return;

    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, message, ...meta };

    if (this.console) {
      const color = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
      console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${message}`);
    }

    if (this.file && this.logDir) {
      const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
      await fs.appendFile(logFile, JSON.stringify(entry) + '\n');
    }
  }

  debug(message, meta) { return this.log('debug', message, meta); }
  info(message, meta) { return this.log('info', message, meta); }
  warn(message, meta) { return this.log('warn', message, meta); }
  error(message, meta) { return this.log('error', message, meta); }
}

export function createLogger(config) {
  return new Logger(config);
}
