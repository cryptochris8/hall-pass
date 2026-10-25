// ─────────────────────────────────────────────────────────────────────────────
// Mixer graph, shared by the live engine and the offline QA harness:
//
//   music ─► musicDuck ─► musicPause ─┬──────────────────────────► master ─► glue comp ─► trim ─► ½ ─► soft clip ─► out
//                                     └► musicSend ─► reverb ──────┘   ▲
//   sfxMinor ─► sfx ─┬────────────────────────────────────────────────┤
//   (duckable)       ├► sfxSend ─► reverb (school hallway, ~1.3 s)     │
//                    └ (per-sound echo sends) ─► PA echo ─► master/reverb
//   ambBed ─► ambPause ─► amb ─┬──────────────────────────────────────┘
//                              └► ambSend ─► reverb
//
// • master = master volume × mute. sfx and the ambience follow the SFX volume, music the music volume.
// • musicPause / ambPause duck on pause; musicDuck + sfxMinor dip under big stingers.
// • muffle: a low-pass on the music + ambience while the student hides in a locker.
// • The compressor glues and catches peaks; the soft clipper after it is a hard
//   ceiling (≈ −0.6 dBFS) so nothing can ever clip, whatever stacks up.
// Copied from ATHLETE MAYHEM's mixer.ts (adapted from TRASH PANDA TROUBLE): the crowd bus is the school
// ambience here, the stadium PA echo is the school PA's slap-back, plus the hiding muffle.
// ─────────────────────────────────────────────────────────────────────────────
import { type Ctx, filterNode, gainNode, holdAt, reverbBuffer, softClipCurve } from './synth';

export interface Mixer {
  ctx: Ctx;
  /** Master volume × mute. */
  master: GainNode;
  /** Music volume. */
  music: GainNode;
  /** Momentary sidechain ducks under stingers. */
  musicDuck: GainNode;
  /** Pause duck for the music. */
  musicPause: GainNode;
  /** SFX volume (UI + gameplay one-shots). */
  sfx: GainNode;
  /** Minor (duckable) one-shots → sfx. */
  sfxMinor: GainNode;
  /** Ambience bus (follows the SFX volume). */
  amb: GainNode;
  /** Pause duck for the ambience. */
  ambPause: GainNode;
  /** Ambience bed input. */
  ambBed: GainNode;
  /** Hiding muffle: low-pass on music + ambience (20 kHz = open). */
  muffle: BiquadFilterNode;
  /** School PA slap-back echo input (per-sound sends). */
  echo: GainNode;
  /** Hallway reverb input (extra sends). */
  reverb: AudioNode;
  compressor: DynamicsCompressorNode;
}

/** Fixed mix trims (tuned with the offline QA meter). */
export const MIX_TRIM = {
  music: 0.5,
  amb: 1.0,
  musicReverb: 0.08,
  sfxReverb: 0.12,
  ambReverb: 0.25,
  echoReturn: 0.55,
  /** Post-compressor trim (the compressor adds automatic makeup gain). */
  output: 0.8,
} as const;

/** Music level while paused (ducked ~70 %). */
export const PAUSE_MUSIC = 0.3;
/** Ambience level while paused. */
export const PAUSE_AMB = 0.3;
/** Muffle cutoff while hidden (Hz). */
export const MUFFLE_HZ = 650;

/** Hold a param where it is, dip it by `amount` at `at`, and let it recover over ~`seconds`. */
export function duckParam(g: AudioParam, base: number, amount: number, seconds: number, at: number): void {
  holdAt(g, at);
  g.setTargetAtTime(base * (1 - amount), at, 0.02);
  g.setTargetAtTime(base, at + seconds * 0.4, seconds * 0.25);
}

export function buildMixer(ctx: Ctx, destination: AudioNode = ctx.destination): Mixer {
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve(ctx);
  clip.oversample = 'none';
  clip.connect(destination);
  const half = gainNode(ctx, 0.5, clip);
  const trim = gainNode(ctx, MIX_TRIM.output, half);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15;
  comp.knee.value = 9;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;
  comp.connect(trim);
  const master = gainNode(ctx, 1, comp);

  const reverb = ctx.createConvolver();
  reverb.normalize = false;
  reverb.buffer = reverbBuffer(ctx);
  // Keep mud out of the bowl: the reverb return is high-passed.
  reverb.connect(filterNode(ctx, 'highpass', 180, 0.6, master));

  // PA slap-back: the announcement bouncing down the hall (~180 ms, two or three repeats).
  const echo = gainNode(ctx, 1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.18;
  const fb = gainNode(ctx, 0.3);
  const echoTone = filterNode(ctx, 'lowpass', 2600, 0.5);
  const echoLow = filterNode(ctx, 'highpass', 220, 0.6);
  echo.connect(echoLow);
  echoLow.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(fb);
  fb.connect(delay);
  const echoOut = gainNode(ctx, MIX_TRIM.echoReturn, master);
  echoTone.connect(echoOut);
  echoTone.connect(gainNode(ctx, 0.25, reverb));

  // Hiding muffle: music and ambience go through one low-pass (open at 20 kHz).
  const muffle = filterNode(ctx, 'lowpass', 20000, 0.7, master);
  const music = gainNode(ctx, MIX_TRIM.music);
  const musicDuck = gainNode(ctx, 1);
  const musicPause = gainNode(ctx, 1, muffle);
  music.connect(musicDuck);
  musicDuck.connect(musicPause);
  musicPause.connect(gainNode(ctx, MIX_TRIM.musicReverb, reverb));

  const sfx = gainNode(ctx, 1, master);
  sfx.connect(gainNode(ctx, MIX_TRIM.sfxReverb, reverb));
  const sfxMinor = gainNode(ctx, 1, sfx);

  const amb = gainNode(ctx, MIX_TRIM.amb, muffle);
  amb.connect(gainNode(ctx, MIX_TRIM.ambReverb, reverb));
  const ambPause = gainNode(ctx, 1, amb);
  const ambBed = gainNode(ctx, 1, ambPause);

  return { ctx, master, music, musicDuck, musicPause, sfx, sfxMinor, amb, ambPause, ambBed, muffle, echo, reverb, compressor: comp };
}
