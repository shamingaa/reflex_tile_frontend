import React, { useEffect, useMemo, useRef, useState } from 'react';

const FLASH_DURATION = 180;

const getGrid = () => {
  if (typeof window === 'undefined') return { cols: 5, rows: 5 };
  return window.innerWidth <= 540 ? { cols: 4, rows: 4 } : { cols: 5, rows: 5 };
};

const COMBO_LABELS = {
  5: 'HOT',
  10: 'ON FIRE',
  20: 'UNSTOPPABLE',
  30: 'GODLIKE',
  50: 'LEGENDARY',
};

// ─── Note maps ──────────────────────────────────────────────────────────────
// C major pentatonic (C D E G A) across 5 octaves.
// Grid reads left-to-right = C→A within the octave,
// top-to-bottom = high octave → low octave (like looking at piano keys on their side).
//
// 5×5 grid: each cell maps to its own unique piano pitch.
const NOTES_5x5 = [
  // Row 0 (top)  — C6      D6      E6      G6      A6
  1046.50, 1174.66, 1318.51, 1567.98, 1760.00,
  // Row 1        — C5      D5      E5      G5      A5
   523.25,  587.33,  659.25,  783.99,  880.00,
  // Row 2 (mid) — C4      D4      E4      G4      A4
   261.63,  293.66,  329.63,  392.00,  440.00,
  // Row 3        — C3      D3      E3      G3      A3
   130.81,  146.83,  164.81,  196.00,  220.00,
  // Row 4 (bot) — C2      D2      E2      G2      A2
    65.41,   73.42,   82.41,   98.00,  110.00,
];

// 4×4 grid: 4 of the 5 pentatonic notes per row (C E G A — drops D for even spacing).
const NOTES_4x4 = [
  // Row 0 (top)  — C5      E5      G5      A5
   523.25,  659.25,  783.99,  880.00,
  // Row 1        — C4      E4      G4      A4
   261.63,  329.63,  392.00,  440.00,
  // Row 2        — C3      E3      G3      A3
   130.81,  164.81,  196.00,  220.00,
  // Row 3 (bot) — C2      E2      G2      A2
    65.41,   82.41,   98.00,  110.00,
];

const getNoteHz = (cellIdx, grid) => {
  const notes = grid.cols === 4 ? NOTES_4x4 : NOTES_5x5;
  return notes[Math.min(cellIdx, notes.length - 1)] ?? 440;
};

// ─── Difficulty presets ─────────────────────────────────────────────────────
const DIFFICULTY = {
  normal: {
    startTime: 30, missPenalty: 4, hazardChance: 0,
    timeRewardCap: 50, paceBase: 1900, paceFloor: 900,
    paceScoreFactor: 4.5, paceStreakFactor: 9,
    rewardBonus: 0.8, rewardFloor: 0.55, rewardSlope: 940, rewardStreakFactor: 0.012,
    minGain: 1.1, wrongClickPenalty: 1.4,
  },
  hard: {
    startTime: 25, missPenalty: 4.5, hazardChance: 0.08,
    timeRewardCap: 40, paceBase: 1500, paceFloor: 700,
    paceScoreFactor: 6.5, paceStreakFactor: 12,
    rewardBonus: 0.65, rewardFloor: 0.38, rewardSlope: 900, rewardStreakFactor: 0.018,
    minGain: 0.85, wrongClickPenalty: 1.6,
  },
  extreme: {
    startTime: 20, missPenalty: 5, hazardChance: 0.14,
    timeRewardCap: 34, paceBase: 1250, paceFloor: 550,
    paceScoreFactor: 8.5, paceStreakFactor: 15,
    rewardBonus: 0.55, rewardFloor: 0.32, rewardSlope: 860, rewardStreakFactor: 0.023,
    minGain: 0.75, wrongClickPenalty: 1.9,
  },
};

const pickCell = (previous, banned = [], count) => {
  const disallow = new Set([previous, ...banned]);
  let attempts = 0, next = previous;
  while (disallow.has(next) && attempts < 40) { next = Math.floor(Math.random() * count); attempts++; }
  return next;
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ─── Component ──────────────────────────────────────────────────────────────

function GameBoard({ playerName, mode, difficulty = 'normal', onFinish, personalBest = 0 }) {
  const [grid, setGrid]           = useState(getGrid);
  const cellCount                 = grid.cols * grid.rows;
  const [status, setStatus]       = useState('idle');
  const [timeLeft, setTimeLeft]   = useState(() => DIFFICULTY[difficulty]?.startTime ?? 30);
  const [score, setScore]         = useState(0);
  const [streak, setStreak]       = useState(0);
  const [misses, setMisses]       = useState(0);
  const [hits, setHits]           = useState(0);
  const [activeCell, setActiveCell] = useState(() => pickCell(-1, [], cellCount));
  const [hazardCell, setHazardCell] = useState(null);
  const [flashMap, setFlashMap]   = useState({});
  const [fastestHit, setFastestHit] = useState(null);
  const [totalReactionMs, setTotalReactionMs] = useState(0);
  const [pops, setPops]           = useState([]);
  const [comboMsg, setComboMsg]   = useState('');

  // Sound toggle — persisted to localStorage
  const [soundOn, setSoundOn] = useState(
    () => localStorage.getItem('arcade_arena_sound') !== '0'
  );
  const soundRef = useRef(soundOn);
  useEffect(() => {
    soundRef.current = soundOn;
    localStorage.setItem('arcade_arena_sound', soundOn ? '1' : '0');
  }, [soundOn]);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const spawnTimeRef     = useRef(performance.now());
  const finishedRef      = useRef(false);
  const scoreRef         = useRef(0);
  const timeLeftRef      = useRef(DIFFICULTY[difficulty]?.startTime ?? 30);
  const flashTimeoutsRef = useRef({});
  const audioCtxRef      = useRef(null);
  const popIdRef         = useRef(0);
  const comboTimerRef    = useRef(null);
  // Stat refs — synchronous counterparts for state; read by endRun
  const hitsRef          = useRef(0);
  const missesRef        = useRef(0);
  const fastestHitRef    = useRef(null);
  const totalReactionRef = useRef(0);
  const maxStreakRef     = useRef(0);

  const settings         = useMemo(() => DIFFICULTY[difficulty] ?? DIFFICULTY.normal, [difficulty]);
  const difficultyWindow = useMemo(
    () => Math.max(settings.paceFloor, settings.paceBase - score * settings.paceScoreFactor - streak * settings.paceStreakFactor),
    [score, streak, settings]
  );

  useEffect(() => { scoreRef.current = score; }, [score]);

  // ── Audio helpers ─────────────────────────────────────────────────────────

  const getAudioCtx = () => {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = audioCtxRef.current || new Ctx();
    audioCtxRef.current = ctx;
    ctx.resume?.();
    return ctx;
  };

  // Original UI tone (beeps for start, pause, miss, wrong-click, combos)
  const playTone = (freq, durationMs = 90, volume = 0.12) => {
    if (!soundRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  };

  // Piano synthesizer — played on every correct tile hit.
  // Simulates piano timbre via a triangle fundamental + sine harmonics,
  // shaped with an ADSR envelope and a warm low-pass filter.
  const playPianoNote = (freq, volume = 0.22) => {
    if (!soundRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 1.6;

    // ADSR master envelope
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + 0.007);           // attack  ~7ms
    master.gain.exponentialRampToValueAtTime(volume * 0.60, now + 0.07); // decay   60ms
    master.gain.exponentialRampToValueAtTime(volume * 0.42, now + 0.28); // sustain settle
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);         // release

    // Warm low-pass (piano rolls off treble; also prevents harshness on high notes)
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = Math.min(freq * 7, 7000);
    lpf.Q.value = 0.55;
    lpf.connect(master);
    master.connect(ctx.destination);

    // Harmonics: [frequency multiplier, relative gain, waveform]
    // Triangle fundamental gives piano's characteristic hollow attack.
    // Sine overtones add warmth without harshness.
    [
      [1,    0.55, 'triangle'],  // fundamental
      [2,    0.22, 'sine'],      // octave
      [3,    0.09, 'sine'],      // perfect 5th above octave
      [4,    0.04, 'sine'],      // 2nd octave (fades under LPF at high freq)
      [0.5,  0.06, 'sine'],      // sub-octave — adds body to bass notes
    ].forEach(([mult, g, type]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type           = type;
      osc.frequency.value = freq * mult;
      gain.gain.value     = g;
      osc.connect(gain).connect(lpf);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    });
  };

  // Soft preview note that whispers the upcoming pitch when the tile appears.
  // Low enough volume that it's a hint, not a spoiler.
  const playPreviewNote = (freq) => {
    if (!soundRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now  = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type           = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.03, now + 0.04);   // very soft
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  };

  // ── Core helpers ──────────────────────────────────────────────────────────

  const flashCell = (cell, type) => {
    if (cell == null) return;
    if (flashTimeoutsRef.current[cell]) clearTimeout(flashTimeoutsRef.current[cell]);
    setFlashMap((prev) => ({ ...prev, [cell]: type }));
    flashTimeoutsRef.current[cell] = setTimeout(() => {
      setFlashMap((prev) => { const n = { ...prev }; delete n[cell]; return n; });
    }, FLASH_DURATION);
  };

  const spawnPop = (cellIdx, text) => {
    const id  = ++popIdRef.current;
    const col = cellIdx % grid.cols;
    const row = Math.floor(cellIdx / grid.cols);
    setPops((prev) => [...prev, { id, text, x: ((col + 0.5) / grid.cols) * 100, y: ((row + 0.5) / grid.rows) * 100 }]);
    setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 750);
  };

  const showCombo = (newStreak) => {
    const label = COMBO_LABELS[newStreak];
    if (!label) return;
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    setComboMsg(label);
    playTone(newStreak >= 20 ? 1000 : 820, 220, 0.18);
    comboTimerRef.current = setTimeout(() => setComboMsg(''), 1200);
  };

  const endRun = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setStatus('done');
    const totalHits   = hitsRef.current;
    const totalMisses = missesRef.current;
    const attempts    = totalHits + totalMisses;
    onFinish?.({
      score:       scoreRef.current,
      playerName,
      mode,
      hits:        totalHits,
      misses:      totalMisses,
      accuracy:    attempts > 0 ? Math.round((totalHits / attempts) * 100) : null,
      fastestHit:  fastestHitRef.current,
      avgReaction: totalHits > 0 ? Math.round(totalReactionRef.current / totalHits) : null,
      maxStreak:   maxStreakRef.current,
    });
  };

  // Synchronous time penalty — uses timeLeftRef to avoid async setState lag
  const applyTimePenalty = (amount) => {
    const newTime = Math.max(0, timeLeftRef.current - amount);
    timeLeftRef.current = newTime;
    setTimeLeft(newTime);
    if (newTime <= 0) { endRun(); return true; }
    return false;
  };

  const spawnNewTarget = () => {
    setActiveCell((prev) => {
      const next = pickCell(prev, [], cellCount);
      spawnTimeRef.current = performance.now();
      setHazardCell(Math.random() < settings.hazardChance ? pickCell(next, [next], cellCount) : null);
      // Whisper the upcoming note so the tile "rings" as it appears
      playPreviewNote(getNoteHz(next, grid));
      return next;
    });
  };

  const resetRefs = () => {
    scoreRef.current = 0;
    hitsRef.current = 0;
    missesRef.current = 0;
    fastestHitRef.current = null;
    totalReactionRef.current = 0;
    maxStreakRef.current = 0;
  };

  const reset = () => {
    if (!playerName || playerName.trim().length === 0) return;
    finishedRef.current = false;
    const startT = settings.startTime;
    timeLeftRef.current = startT;
    resetRefs();
    setStatus('playing');
    setTimeLeft(startT);
    setScore(0); setStreak(0); setMisses(0); setHits(0);
    setFastestHit(null); setTotalReactionMs(0);
    setPops([]); setComboMsg(''); setFlashMap({});
    const next = pickCell(-1, [], cellCount);
    spawnTimeRef.current = performance.now();
    setActiveCell(next);
    setHazardCell(settings.hazardChance > 0 && Math.random() < settings.hazardChance
      ? pickCell(next, [next], cellCount) : null);
    playTone(640, 120, 0.16);
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  // Timer countdown
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        const next = +(prev - 0.1).toFixed(2);
        timeLeftRef.current = next;
        if (next <= 0) { clearInterval(id); endRun(); return 0; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [status]); // eslint-disable-line

  // Miss timeout — restarts whenever the active tile or pacing changes
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const timeout = setTimeout(() => registerMiss(), difficultyWindow);
    return () => clearTimeout(timeout);
  }, [status, activeCell, difficultyWindow]); // eslint-disable-line

  // Block accidental refresh while playing
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      // Block F5 / Ctrl+R / Cmd+R refresh while playing
      if (status === 'playing') {
        const isRefresh = e.code === 'F5' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyR');
        if (isRefresh) { e.preventDefault(); return; }
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if ((status === 'idle' || status === 'done') && playerName?.trim()) reset();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (status === 'playing') setStatus('paused');
        else if (status === 'paused') setStatus('playing');
      }
      if (e.code === 'KeyM') setSoundOn((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, playerName]); // eslint-disable-line

  // Cleanup timers on unmount
  useEffect(() => () => {
    Object.values(flashTimeoutsRef.current).forEach(clearTimeout);
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
  }, []);

  // Reset when difficulty changes
  useEffect(() => {
    finishedRef.current = false;
    const startT = settings.startTime;
    timeLeftRef.current = startT;
    resetRefs();
    setStatus('idle'); setTimeLeft(startT);
    setScore(0); setStreak(0); setMisses(0); setHits(0);
    setFastestHit(null); setTotalReactionMs(0);
    setPops([]); setComboMsg(''); setFlashMap({});
    setActiveCell(pickCell(-1, [], cellCount)); setHazardCell(null);
  }, [settings, cellCount]); // eslint-disable-line

  // Resize
  useEffect(() => {
    const onResize = () => {
      const next = getGrid();
      setGrid((prev) => (prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Game actions ──────────────────────────────────────────────────────────

  const registerMiss = () => {
    if (status !== 'playing') return;
    setStreak(0);
    setMisses((m) => m + 1);
    missesRef.current += 1;
    flashCell(activeCell, 'miss');
    playTone(220, 140, 0.13);
    const ended = applyTimePenalty(settings.missPenalty);
    if (!ended) spawnNewTarget();
  };

  const resumeGame = () => {
    if (status === 'paused') { setStatus('playing'); playTone(520, 120, 0.1); }
  };

  const registerHit = (cellIndex) => {
    if (status !== 'playing') return;

    // ── Hazard tile ──
    if (cellIndex === hazardCell) {
      flashCell(cellIndex, 'hazard');
      playTone(140, 180, 0.15);
      setHazardCell(null);
      setStreak(0);
      missesRef.current += 1;
      setScore((s) => { const v = Math.max(s - 10, 0); scoreRef.current = v; return v; });
      const ended = applyTimePenalty(settings.missPenalty + 1);
      if (!ended) spawnNewTarget();
      return;
    }

    // ── Wrong tile ──
    if (cellIndex !== activeCell) {
      setStreak(0);
      missesRef.current += 1;
      flashCell(cellIndex, 'miss');
      playTone(185, 120, 0.12);
      applyTimePenalty(settings.wrongClickPenalty ?? 2.5);
      if (navigator?.vibrate) navigator.vibrate(70);
      return;
    }

    // ── Correct hit ──
    const reaction = performance.now() - spawnTimeRef.current;
    const reactionRounded = Math.round(reaction);

    setFastestHit((prev) => (prev === null ? reactionRounded : Math.min(prev, reactionRounded)));
    setTotalReactionMs((prev) => prev + reaction);
    setHits((prev) => prev + 1);
    hitsRef.current += 1;
    totalReactionRef.current += reaction;
    if (fastestHitRef.current === null || reactionRounded < fastestHitRef.current) {
      fastestHitRef.current = reactionRounded;
    }

    flashCell(cellIndex, 'hit');

    // Play the piano note mapped to this cell's grid position
    playPianoNote(getNoteHz(cellIndex, grid));

    const speedBonus  = Math.max(2, Math.round((1200 - reaction) / 30));
    const streakBonus = Math.max(0, streak - 1) * 4;
    const gained      = 15 + speedBonus + streakBonus;

    setScore((s) => { const v = Math.max(s + gained, 0); scoreRef.current = v; return v; });
    spawnPop(cellIndex, `+${gained}`);

    const newStreak = streak + 1;
    setStreak(newStreak);
    if (newStreak > maxStreakRef.current) maxStreakRef.current = newStreak;
    showCombo(newStreak);

    const timeReward = Math.max(settings.rewardFloor,
      1.25 - reaction / settings.rewardSlope - streak * settings.rewardStreakFactor);
    const gain    = Math.max(settings.minGain, timeReward + settings.rewardBonus);
    const newTime = clamp(timeLeftRef.current + gain, 0, settings.timeRewardCap);
    timeLeftRef.current = newTime;
    setTimeLeft(newTime);

    spawnNewTarget();
  };

  // ── Derived display values ────────────────────────────────────────────────

  const totalAttempts = hits + misses;
  const accuracy      = totalAttempts > 0 ? Math.round((hits / totalAttempts) * 100) : null;
  const avgReaction   = hits > 0 ? Math.round(totalReactionMs / hits) : null;
  const isNewBest     = status === 'done' && personalBest > 0 && score > personalBest;
  const isFirstBest   = status === 'done' && personalBest === 0 && score > 0;
  const timebarBanked = timeLeft > settings.startTime;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="game-panel">
      {/* HUD */}
      <div className="hud hud--compact">
        <div className="hud-block">
          <p className="label">Player</p>
          <p className="value">{playerName || '—'}</p>
        </div>
        <div className="hud-block">
          <p className="label">Score</p>
          <p className="value score">{score}</p>
          {streak >= 3 && status === 'playing' && (
            <p className="value small" style={{ color: 'var(--accent)', marginTop: 2 }}>x{streak}</p>
          )}
        </div>
        <div className="hud-block">
          {personalBest > 0 && <p className="value small pb-line">PB {personalBest}</p>}
          <div className="timebar">
            <div
              className={`timebar-fill${timebarBanked ? ' timebar-fill--banked' : ''}`}
              style={{ width: `${Math.min(100, (timeLeft / settings.startTime) * 100)}%` }}
            />
          </div>
          <p className="value small">{timeLeft.toFixed(1)}s</p>
        </div>
      </div>

      {/* Arena */}
      <div
        className="arena"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
        onTouchMove={(e) => e.preventDefault()}
      >
        {[...Array(cellCount)].map((_, idx) => (
          <button
            key={idx}
            type="button"
            className={[
              'cell',
              idx === activeCell  ? 'cell--active cell--life' : '',
              idx === hazardCell  ? 'cell--hazard'            : '',
              flashMap[idx]       ? `cell--flash-${flashMap[idx]}` : '',
            ].join(' ').trim()}
            style={idx === activeCell ? { '--life': `${difficultyWindow}ms` } : undefined}
            onPointerDown={(e) => { e.preventDefault(); registerHit(idx); }}
            aria-label={idx === activeCell ? 'Active target' : idx === hazardCell ? 'Hazard' : 'Tile'}
          />
        ))}

        {/* Floating score popups */}
        {pops.map((pop) => (
          <div key={pop.id} className="score-pop" style={{ left: `${pop.x}%`, top: `${pop.y}%` }}>
            {pop.text}
          </div>
        ))}

        {/* Combo announcement */}
        {comboMsg && <div className="combo-msg">{comboMsg}</div>}

        {/* Overlays (idle / paused / done) */}
        {status !== 'playing' && (
          <div className="overlay">
            <div className="overlay-card">
              {status === 'paused' ? (
                <>
                  <p className="headline">Paused</p>
                  <p className="sub">Press P or Esc to continue.</p>
                  <button className="cta" onClick={resumeGame}>Resume</button>
                  <button className="mini-btn ghost" onClick={reset}>Restart</button>
                </>
              ) : (
                <>
                  <p className="headline">{status === 'idle' ? 'Arcade Arena' : 'Run Complete'}</p>

                  {status === 'done' ? (
                    <>
                      {(isNewBest || isFirstBest) && (
                        <p className="new-best-badge">
                          {isFirstBest ? 'FIRST SCORE SET' : 'NEW PERSONAL BEST'}
                        </p>
                      )}
                      <div className="end-stats">
                        <div className="end-stat">
                          <span className="end-stat-label">Score</span>
                          <span className="end-stat-value accent">{score}</span>
                        </div>
                        {accuracy !== null && (
                          <div className="end-stat">
                            <span className="end-stat-label">Accuracy</span>
                            <span className="end-stat-value">{accuracy}%</span>
                          </div>
                        )}
                        {fastestHit !== null && (
                          <div className="end-stat">
                            <span className="end-stat-label">Best snap</span>
                            <span className="end-stat-value">{fastestHit} ms</span>
                          </div>
                        )}
                        {avgReaction !== null && (
                          <div className="end-stat">
                            <span className="end-stat-label">Avg reaction</span>
                            <span className="end-stat-value">{avgReaction} ms</span>
                          </div>
                        )}
                        {personalBest > 0 && (
                          <div className="end-stat">
                            <span className="end-stat-label">Personal best</span>
                            <span className="end-stat-value">{Math.max(score, personalBest)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="sub">
                      Tap green tiles fast — each one plays a piano note.
                      {settings.hazardChance > 0 ? ' Dodge red decoys.' : ''}
                    </p>
                  )}

                  <button className="cta" onClick={reset}>
                    {status === 'idle' ? 'Start' : 'Play Again  (Space)'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sound toggle — always accessible below the arena */}
      <div className="sound-bar">
        <button
          className={`sound-toggle${soundOn ? '' : ' sound-toggle--off'}`}
          onClick={() => setSoundOn((v) => !v)}
          title="Toggle sound (M)"
        >
          <span className="sound-icon">{soundOn ? '♪' : '♪'}</span>
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </div>
  );
}

export default GameBoard;
