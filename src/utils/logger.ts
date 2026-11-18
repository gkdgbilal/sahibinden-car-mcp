type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return ORDER[raw] ?? ORDER.info;
}

function write(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  process.stderr.write(JSON.stringify({ level, msg, ...meta }) + '\n');
}

// stdout MCP protokolüne ayrılmıştır; loglar yalnızca stderr'e gider.
export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};
