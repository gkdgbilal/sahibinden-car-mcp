import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock } from '../../src/browser/lock.js';

let dir: string;
let lock: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-lock-'));
  lock = path.join(dir, 'browser.lock');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('acquireLock', () => {
  it('ikinci alma null (busy); release sonrası alınır', () => {
    const now = () => 1000;
    const r1 = acquireLock(lock, { now });
    expect(r1).toBeTypeOf('function');
    expect(acquireLock(lock, { now })).toBeNull();
    r1!();
    expect(fs.existsSync(lock)).toBe(false);
    const r2 = acquireLock(lock, { now });
    expect(r2).toBeTypeOf('function');
    r2!();
  });

  it('kilit dosyasına pid ve zaman yazılır', () => {
    acquireLock(lock, { now: () => 42, pid: 7 });
    expect(JSON.parse(fs.readFileSync(lock, 'utf8'))).toEqual({ pid: 7, at: 42 });
  });

  it('bayat kilit (10 dk+) devralınır, taze kilit devralınmaz', () => {
    acquireLock(lock, { now: () => 0 });
    expect(acquireLock(lock, { now: () => 600_000 })).toBeNull(); // tam 10 dk: hâlâ taze
    const r = acquireLock(lock, { now: () => 600_001 });
    expect(r).toBeTypeOf('function');
    expect(JSON.parse(fs.readFileSync(lock, 'utf8')).at).toBe(600_001);
  });

  it('bozuk içerikli kilit mtime ile değerlendirilir (taze → busy)', () => {
    fs.writeFileSync(lock, 'garbage');
    expect(acquireLock(lock, { now: () => Date.now() })).toBeNull();
    expect(acquireLock(lock, { now: () => Date.now() + 700_000 })).toBeTypeOf('function');
  });
});
