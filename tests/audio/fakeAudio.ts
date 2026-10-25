// Stubbed Web Audio for the engine tests (adapted from TRASH PANDA TROUBLE's lifecycle test):
// a context whose clock follows (fake) performance.now(), nodes that accept every call,
// state changes with 'statechange' events, an autoplay-policy switch, a "broken stack"
// switch, and a node counter so tests can see whether a sound was actually scheduled.
import { vi } from 'vitest';

function fakeParam(v = 0): Record<string, unknown> {
  const p: Record<string, unknown> = { value: v, defaultValue: v };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime', 'setValueCurveAtTime'])
    p[m] = () => p;
  return p;
}

const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release', 'offset', 'delayTime'];

export function fakeNode(): Record<string, unknown> {
  const n: Record<string, unknown> = {
    connect: (d: unknown) => d,
    disconnect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    setPeriodicWave: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  for (const k of PARAMS) n[k] = fakeParam(1);
  return n;
}

function fakeBuffer(ch: number, len: number, sr: number): Record<string, unknown> {
  const data = Array.from({ length: ch }, () => new Float32Array(len));
  return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, copyToChannel: () => undefined, getChannelData: (c: number) => data[c] };
}

export class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  /** Whether resume() is allowed to start the context (autoplay policy). */
  static allowStart = true;
  /** Make node creation throw (a broken audio stack). */
  static explode = false;
  state: string;
  sampleRate = 44100;
  destination = fakeNode();
  resumeCalls = 0;
  /** Number of create*() calls (≈ nodes scheduled). */
  nodes = 0;
  frozen = false;
  private t = 0;
  private wall = performance.now();

  constructor() {
    super();
    this.state = FakeAudioContext.allowStart ? 'running' : 'suspended';
    FakeAudioContext.instances.push(this);
    return new Proxy(this, {
      get(target, key, recv) {
        if (typeof key === 'string' && key.startsWith('create') && !(key in target)) {
          return (...args: number[]) => {
            if (FakeAudioContext.explode) throw new Error('boom');
            target.nodes++;
            return key === 'createBuffer' ? fakeBuffer(args[0]!, args[1]!, args[2]!) : fakeNode();
          };
        }
        const v = Reflect.get(target, key, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  get currentTime(): number {
    const now = performance.now();
    if (this.state === 'running' && !this.frozen) this.t += (now - this.wall) / 1000;
    this.wall = now;
    return this.t;
  }

  setState(s: string): void {
    void this.currentTime;
    this.state = s;
    this.dispatchEvent(new Event('statechange'));
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (FakeAudioContext.allowStart && this.state !== 'closed' && this.state !== 'running') this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    if (this.state === 'running') this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.state !== 'closed') this.setState('closed');
    return Promise.resolve();
  }
}

export class FakeDocument extends EventTarget {
  hidden = false;
}

export interface FakeEnv {
  win: EventTarget;
  doc: FakeDocument;
  activation: { hasBeenActive: boolean; isActive: boolean };
  ctxs: () => FakeAudioContext[];
  last: () => FakeAudioContext;
}

/** Install the fakes (call in beforeEach); pair with uninstallFakeAudio() in afterEach. */
export function installFakeAudio(): FakeEnv {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  FakeAudioContext.instances = [];
  FakeAudioContext.allowStart = true;
  FakeAudioContext.explode = false;
  const activation = { hasBeenActive: false, isActive: false };
  const win = new EventTarget();
  const doc = new FakeDocument();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userActivation: activation });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const ctxs = (): FakeAudioContext[] => FakeAudioContext.instances;
  return { win, doc, activation, ctxs, last: () => ctxs()[ctxs().length - 1]! };
}

export function uninstallFakeAudio(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

/** A bare fake context for scheduling recipes / players directly. */
export function bareContext(): AudioContext {
  return new FakeAudioContext() as unknown as AudioContext;
}
