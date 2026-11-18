import { describe, expect, it } from 'vitest';
import { pingHandler } from '../src/tools/ping.js';

describe('ping', () => {
  it('varsayılan olarak ok döner', () => {
    expect(pingHandler({}).pong).toBe('ok');
  });
  it('msg değerini geri yansıtır', () => {
    expect(pingHandler({ msg: 'x' }).pong).toBe('x');
  });
});
