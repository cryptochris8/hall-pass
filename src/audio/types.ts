// ─────────────────────────────────────────────────────────────────────────────
// AUDIO CONTRACT (docs/GDD.md §14) — every sound is synthesized with Web Audio at
// runtime. No audio files, no network, no paid APIs, no existing melodies. The
// game is fully playable muted. Owner: audio.
// ─────────────────────────────────────────────────────────────────────────────

export type SfxName =
  // ── UI / presentation ──
  | 'uiMove'
  | 'uiConfirm'
  | 'uiBack'
  | 'uiDenied'
  | 'flyover' // tense two-chord sting under the mission card
  | 'stamp' // the Hall Report rank stamp
  | 'gradeA' // bright chime for an A / A+
  | 'gradeLow' // a dry "hmm" two-note for B and below
  | 'newBest' // personal best sparkle
  // ── the student ──
  | 'step' // soft sneaker on tile
  | 'squeak' // sprinting sneaker squeak (louder on polished floors)
  | 'lockerIn' // climbing into a locker / stall / under the bleachers (door clunk)
  | 'lockerOut'
  | 'grab' // eraser / generic small pickup
  | 'item' // a mission item collected
  | 'snack' // gummy pack crinkle + blip
  | 'throw' // eraser toss whoosh
  | 'eraserLand' // eraser lands (soft thud + bounce)
  // ── staff / detection ──
  | 'curious' // "?" — someone noticed something
  | 'spotted' // "!" sting
  | 'whistle' // hall monitor whistle (chase starts)
  | 'lostThem' // relieved descending wobble
  | 'busted' // record scratch
  | 'passFlash' // flashing the hall pass (paper flick + ding)
  | 'cameraAlert' // camera servo whine + two beeps
  | 'found' // yanked out of a hiding spot
  // ── school ──
  | 'paChime' // the PA "ding-dong" before an announcement
  | 'bell' // the school bell (end of period)
  | 'clockTick' // 30 s / 10 s warning tick-tock
  | 'lunchBell' // short cafeteria bell
  | 'vendWhir' // vending machine motor whir (purchase start)
  | 'vendRattle' // the once-a-second rattle during the purchase
  | 'vendClunk' // the bag drops
  | 'buyCancel' // purchase cancelled: coins clatter back
  // ── endings ──
  | 'success' // brass hit + bell: back in your seat
  | 'detention' // sad trombone
  // ── babble voices (pitch per character via SfxOptions.pitch) ──
  | 'vHey'
  | 'vHm'
  | 'vWhere' // "Where are we going?"
  | 'vCarryOn' // "Oh — carry on."
  | 'vTattle' // Preston: "Someone's out of class!"
  | 'vNotYet' // lunch staff: "Not yet, hon."
  | 'vAnnounce'; // PA babble announcement

export interface SfxOptions {
  /** Pitch multiplier (1 = normal). Voices: the character's voice pitch. */
  pitch?: number;
  /** 0..1 gain multiplier (distance falloff for things in the world). */
  volume?: number;
  /** −1 (left) .. +1 (right). */
  pan?: number;
}

export type MusicTrack = 'title' | 'menu' | 'sneak' | 'report' | 'none';

export interface AudioVolumes {
  /** All 0..1. */
  master: number;
  music: number;
  sfx: number;
}

export interface AudioEngine {
  /** Create/resume the AudioContext. Must be called from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void;
  readonly unlocked: boolean;
  play(name: SfxName, opts?: SfxOptions): void;
  /** Crossfade to a music track. 'none' fades out. Idempotent. */
  setMusic(track: MusicTrack): void;
  /** Suspicion on screen 0..1 (sneak track layers: calm → curious → chase). */
  setIntensity(level: number): void;
  /** School ambience (fluorescent hum + distant chatter) level 0..1; negative switches it off. */
  setAmbience(level: number): void;
  /** Hidden in a locker: muffle the world (ambience and music get dark and close). */
  setMuffled(muffled: boolean): void;
  setVolumes(v: AudioVolumes): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Paused / tab hidden: duck music and ambience. */
  setPaused(paused: boolean): void;
  dispose(): void;
}
