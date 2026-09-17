/**
 * log.ts — minimal structured logger. Avoid pulling pino as a dep unless
 * log volume needs it. Fields:
 *
 *   { ts, level, msg, ...ctx }
 *
 * JSON line output is intentional for Vercel's log drain.
 */

import { config } from './config.js';

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function shouldLog(level: keyof typeof LEVEL_RANK): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.logLevel];
}

function emit(level: keyof typeof LEVEL_RANK, msg: string, ctx?: object) {
  if (!shouldLog(level)) return;
  const line = { ts: new Date().toISOString(), level, msg, ...ctx };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const log = {
  debug: (msg: string, ctx?: object) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: object) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: object) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: object) => emit('error', msg, ctx),
};
