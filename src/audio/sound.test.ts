import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { WebAudioSoundPlayer } from './sound';

/** AudioContext factice : enregistre les buffers joués. */
function fakeContext() {
  const played: unknown[] = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    played,
    resume: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: { value: 1, setValueAtTime() {} } }),
    createBufferSource: () => {
      const src = {
        ...node(),
        buffer: null as unknown,
        playbackRate: { value: 1 },
        onended: null as unknown,
        start() {
          played.push(src.buffer);
        },
      };
      return src;
    },
    decodeAudioData: (data: ArrayBuffer) => {
      const tag = new TextDecoder().decode(data);
      if (tag === 'bad') return Promise.reject(new Error('décodage'));
      return Promise.resolve({ tag });
    },
  };
  return ctx;
}

const fetchBuffer = async (url: string): Promise<ArrayBuffer> => {
  if (url.includes('404')) throw new Error('404');
  return new TextEncoder().encode(url.includes('bad') ? 'bad' : url).buffer as ArrayBuffer;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WebAudioSoundPlayer', () => {
  it('ne fait rien (ni erreur) avant unlock ou sans Web Audio', () => {
    const p = new WebAudioSoundPlayer({ place: ['a.ogg'] }, { createContext: () => null, fetchBuffer });
    expect(() => p.play('place')).not.toThrow();
    expect(() => p.unlock()).not.toThrow();
    expect(() => p.play('break', { blockId: BlockId.Stone })).not.toThrow();
  });

  it('charge après unlock, choisit le groupe selon le bloc et ignore les fichiers en échec', async () => {
    const ctx = fakeContext();
    const p = new WebAudioSoundPlayer(
      { break_stone: ['stone1.ogg', 'stone-404.ogg', 'stone-bad.ogg'], place: ['place.ogg'] },
      { createContext: () => ctx as unknown as AudioContext, fetchBuffer, rand: () => 0 },
    );
    p.setEnabled(true);
    p.unlock();
    await flush();
    await flush();
    p.play('break', { blockId: BlockId.Brick });
    p.play('place');
    p.play('jump'); // groupe absent : silence
    p.play('break', { blockId: BlockId.Glass }); // groupe absent : silence
    expect(ctx.played).toEqual([{ tag: 'stone1.ogg' }, { tag: 'place.ogg' }]);
  });

  it('respecte le bouton son coupé', async () => {
    const ctx = fakeContext();
    const p = new WebAudioSoundPlayer({ click: ['c.ogg'] }, { createContext: () => ctx as unknown as AudioContext, fetchBuffer });
    p.unlock();
    await flush();
    await flush();
    p.setEnabled(false);
    p.play('click');
    expect(ctx.played).toHaveLength(0);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    p.play('click');
    expect(ctx.played).toHaveLength(1);
  });
});
