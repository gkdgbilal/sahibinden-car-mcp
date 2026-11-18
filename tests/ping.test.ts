import { describe, expect, it } from 'vitest';
import type { Provider } from '../src/providers/provider.js';
import { pingHandler } from '../src/tools/ping.js';

const provider = { name: 'fake', stats: async () => ({ storeSize: 7, inboxDir: '/tmp/x' }) } as unknown as Provider;

describe('ping', () => {
  it('varsayılan olarak ok döner ve provider bilgisi ekler', async () => {
    expect(await pingHandler({}, { provider })).toMatchObject({ pong: 'ok', provider: 'fake', storeSize: 7, inboxDir: '/tmp/x' });
  });
  it('msg değerini geri yansıtır', async () => {
    expect((await pingHandler({ msg: 'x' }, { provider })).pong).toBe('x');
  });
});
