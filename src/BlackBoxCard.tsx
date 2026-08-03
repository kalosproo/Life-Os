import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'black-box:v1';
const OPEN_DURATION_MS = 3400;
const GLOW_DURATION_MS = 300;

type RewardKind = 'word' | 'sentence' | 'artifact' | 'glyph';

type Reward = {
  id: string;
  kind: RewardKind;
  title: string;
  detail?: string;
};

type BlackBoxState = {
  openedToday: boolean;
  openedAt: string | null;
  todayReward: Reward;
  lastOpenedDate: string | null;
  history: string[];
};

type BlackBoxCardProps = {
  enabled: boolean;
  todayKey?: string;
};

const seedRewards: Reward[] = [
  { id: 'tiny-moon', kind: 'artifact', title: 'a tiny moon' },
  { id: 'floating-feather', kind: 'artifact', title: 'a floating feather' },
  { id: 'burning-match', kind: 'artifact', title: 'a burning match' },
  { id: 'paper-crane', kind: 'artifact', title: 'a paper crane' },
  { id: 'marble', kind: 'artifact', title: 'a marble' },
  { id: 'keep-going', kind: 'word', title: 'Keep Going.' },
  { id: 'impossible-staircase', kind: 'artifact', title: 'an impossible staircase' },
  { id: 'glass-leaf', kind: 'artifact', title: 'a glass leaf' },
  { id: 'blinking-star', kind: 'glyph', title: '✶' },
  { id: 'miniature-doorway', kind: 'artifact', title: 'a miniature doorway' },
  { id: 'folded-letter', kind: 'artifact', title: 'a folded letter' },
  { id: 'tiny-planet', kind: 'artifact', title: 'a tiny planet' },
];

const rewardAdjectives = [
  'silver', 'silent', 'paper', 'glass', 'small', 'distant', 'winter', 'velvet', 'hidden', 'hollow',
  'borrowed', 'blue', 'unlit', 'soft', 'ancient', 'folded', 'quiet', 'midnight', 'porcelain', 'threaded',
];

const rewardObjects = [
  'bell', 'key', 'window', 'shell', 'seed', 'stone', 'cloud', 'comet', 'ribbon', 'lantern',
  'coin', 'mirror', 'ladder', 'orchid', 'book', 'door', 'vessel', 'pin', 'pearl', 'map',
];

const dreamFragments = [
  'The room remembered your name.', 'A star blinked once, then waited.', 'Something small chose to stay.',
  'The letter was addressed to tomorrow.', 'A doorway appeared where the wall exhaled.', 'The light folded itself into a square.',
  'One quiet thing moved closer.', 'The ocean fit inside a thimble.', 'A staircase forgot which way was up.',
  'The match burned without becoming less.', 'A moon was left on the table.', 'The feather refused to fall.',
];

function buildRewards(): Reward[] {
  const generated: Reward[] = [];
  for (const adjective of rewardAdjectives) {
    for (const object of rewardObjects) {
      generated.push({
        id: `${adjective}-${object}`,
        kind: 'artifact',
        title: `a ${adjective} ${object}`,
      });
    }
  }
  dreamFragments.forEach((fragment, index) => {
    generated.push({ id: `dream-${index}`, kind: 'sentence', title: fragment });
  });
  return [...seedRewards, ...generated].slice(0, 365);
}

const rewards = buildRewards();

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rewardForDay(history: string[]) {
  const used = new Set(history);
  const remaining = rewards.filter(reward => !used.has(reward.id));
  if (!remaining.length) return rewards[0];
  const daySeed = Math.floor(Date.now() / 86400000);
  return remaining[daySeed % remaining.length];
}

function loadState(today: string): BlackBoxState {
  const fallbackHistory: string[] = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    const history = Array.isArray(parsed?.history) ? parsed.history : fallbackHistory;
    if (parsed?.lastOpenedDate === today && parsed?.todayReward) {
      return { openedToday: true, openedAt: parsed.openedAt || null, todayReward: parsed.todayReward, lastOpenedDate: today, history };
    }
    return { openedToday: false, openedAt: null, todayReward: rewardForDay(history), lastOpenedDate: parsed?.lastOpenedDate || null, history };
  } catch {
    return { openedToday: false, openedAt: null, todayReward: rewardForDay(fallbackHistory), lastOpenedDate: null, history: fallbackHistory };
  }
}

function saveState(state: BlackBoxState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return reduced;
}

function tapHaptic() {
  if ('vibrate' in navigator) navigator.vibrate(8);
}

function softClick(audioRef: React.MutableRefObject<AudioContext | null>) {
  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  const ctx = audioRef.current || new AudioCtor();
  audioRef.current = ctx;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = 220;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.018, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.09);
}

export default function BlackBoxCard({ enabled, todayKey = dateKey() }: BlackBoxCardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<BlackBoxState>(() => loadState(todayKey));
  const [open, setOpen] = useState(false);
  const [glow, setGlow] = useState(false);
  const closeTimer = useRef<number>();
  const glowTimer = useRef<number>();
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => setState(loadState(todayKey)), [todayKey]);
  useEffect(() => () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(glowTimer.current);
  }, []);

  const statusText = state.openedToday ? 'Opened Today' : enabled ? 'Open once.' : 'Log today’s mood to reveal the box.';

  const handleOpen = useCallback(() => {
    if (!enabled || state.openedToday || open) return;
    tapHaptic();
    softClick(audioRef);
    setGlow(true);
    setOpen(true);
    glowTimer.current = window.setTimeout(() => setGlow(false), GLOW_DURATION_MS);
    closeTimer.current = window.setTimeout(() => {
      const nextHistory = [...state.history, state.todayReward.id].slice(-365);
      const nextState = { openedToday: true, openedAt: new Date().toISOString(), todayReward: state.todayReward, lastOpenedDate: todayKey, history: nextHistory };
      saveState(nextState);
      setState(nextState);
      setOpen(false);
    }, reducedMotion ? 1200 : OPEN_DURATION_MS);
  }, [enabled, open, reducedMotion, state, todayKey]);

  const cardClass = useMemo(() => [
    'black-box-card', open ? 'is-open' : '', glow ? 'is-glowing' : '', state.openedToday ? 'is-opened' : '', !enabled ? 'is-locked' : '', reducedMotion ? 'reduce-motion' : '',
  ].filter(Boolean).join(' '), [enabled, glow, open, reducedMotion, state.openedToday]);

  return (
    <section className="black-box-wrap" aria-label="The Black Box daily ritual">
      <button className={cardClass} onClick={handleOpen} disabled={!enabled || state.openedToday} aria-label={state.openedToday ? 'The Black Box, opened today' : 'The Black Box, open once'}>
        <span className="box-lid" aria-hidden="true" />
        <span className="box-copy">
          <span className="box-label">TODAY&apos;S BOX</span>
          <span className="box-status">{state.openedToday ? '✓ ' : ''}{statusText}</span>
        </span>
        {open && (
          <span className={`box-reward reward-${state.todayReward.kind}`} role="status" aria-live="polite">
            {state.todayReward.title}
          </span>
        )}
      </button>
    </section>
  );
}
