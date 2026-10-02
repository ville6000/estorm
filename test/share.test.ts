import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '../web/share.ts';

const checkout = readFileSync(new URL('../examples/checkout.estorm', import.meta.url), 'utf8');

describe('share', () => {
  it('round-trips a board and its name', async () => {
    const hash = await encode({ name: 'checkout.estorm', text: checkout });
    expect(await decode('#' + hash)).toEqual({ name: 'checkout.estorm', text: checkout });
  });

  it('round-trips non-ASCII text', async () => {
    const text = 'Asiakas: Tilaa → (Tilaus) -> TilausLähetetty 🎉\n';
    expect((await decode(await encode({ name: 'ä b.estorm', text })))?.text).toBe(text);
  });

  it('uses only URL-safe characters', async () => {
    expect(await encode({ name: 'b.estorm', text: checkout })).toMatch(/^name=b.estorm&board=[A-Za-z0-9_-]+$/);
  });

  it('compresses', async () => {
    expect((await encode({ name: 'b.estorm', text: checkout })).length).toBeLessThan(checkout.length);
  });

  it('defaults the name', async () => {
    const hash = (await encode({ name: '', text: 'A' })).replace('name=&', '');
    expect(await decode(hash)).toEqual({ name: 'shared.estorm', text: 'A' });
  });

  it('returns null without a board', async () => {
    expect(await decode('')).toBeNull();
    expect(await decode('#name=x')).toBeNull();
  });

  it('returns null for a damaged board', async () => {
    expect(await decode('#board=not-a-board')).toBeNull();
    expect(await decode('#board=%%%')).toBeNull();
  });
});
