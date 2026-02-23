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

const DIFFICULTY = {
  normal: {
    startTime: 30,
    missPenalty: 4,
    hazardChance: 0,
    timeRewardCap: 50,
    paceBase: 1900,
    paceFloor: 900,
    paceScoreFactor: 4.5,
    paceStreakFactor: 9,
    rewardBonus: 0.8,
    rewardFloor: 0.55,
    rewardSlope: 940,
    rewardStreakFactor: 0.012,
    minGain: 1.1,
    wrongClickPenalty: 1.4,
  },
  hard: {
    startTime: 25,
    missPenalty: 4.5,
    hazardChance: 0.08,
    timeRewardCap: 40,
    paceBase: 1500,
    paceFloor: 700,
    paceScoreFactor: 6.5,
    paceStreakFactor: 12,
    rewardBonus: 0.65,
    rewardFloor: 0.38,
    rewardSlope: 900,
    rewardStreakFactor: 0.018,
    minGain: 0.85,
    wrongClickPenalty: 1.6,
  },
  extreme: {
    startTime: 20,
    missPenalty: 5,
    hazardChance: 0.14,
    timeRewardCap: 34,
    paceBase: 1250,
    paceFloor: 550,
    paceScoreFactor: 8.5,
    paceStreakFactor: 15,
    rewardBonus: 0.55,
    rewardFloor: 0.32,
    rewardSlope: 860,
    rewardStreakFactor: 0.023,
    minGain: 0.75,
    wrongClickPenalty: 1.9,
  },
};

const pickCell = (previous, banned = [], count) => {
  const disallow = new Set([previous, ...banned]);
  let attempts = 0;
  let next = previous;
  while (disallow.has(next) && attempts < 40) {
    next = Math.floor(Math.random() * count);
    attempts += 1;
  }
  return next;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function GameBoard({ playerName, mode, difficulty = 'normal', onFinish, personalBest = 0 }) {
  const [grid, setGrid] = useState(getGrid);
  const cellCount = grid.cols * grid.rows;
  const [status, setStatus] = useState('idle');
  const [timeLeft, setTimeLeft] = useState(() => DIFFICULTY[difficulty]?.startTime ?? DIFFICULTY.normal.startTime);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [misses, setMisses] = useState(0);
  const [hits, setHits] = useState(0);
  const [activeCell, setActiveCell] = useState(() => pickCell(-1, [], cellCount));
  const [hazardCell, setHazardCell] = useState(null);
  const [flashMap, setFlashMap] = useState({});
  const [fastestHit, setFastestHit] = useState(null);
  const [totalReactionMs, setTotalReactionMs] = useState(0);
  const [pops, setPops] = useState([]);
  const [comboMsg, setComboMsg] = useState('');

  const spawnTimeRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const scoreRef = useRef(0);
  // FIX: timeLeftRef enables synchronous time reads inside applyTimePenalty
  const timeLeftRef = useRef(DIFFICULTY[difficulty]?.startTime ?? DIFFICULTY.normal.startTime);
  const flashTimeoutsRef = useRef({});
  const audioCtxRef = useRef(null);
  const popIdRef = useRef(0);
  const comboTimerRef = useRef(null);
  // Stat refs — kept in sync with state so endRun can read them synchronously
  const hitsRef          = useRef(0);
  const missesRef        = useRef(0);
  const fastestHitRef    = useRef(null);
  const totalReactionRef = useRef(0);
  const maxStreakRef     = useRef(0);

  const settings = useMemo(() => DIFFICULTY[difficulty] ?? DIFFICULTY.normal, [difficulty]);

  const difficultyWindow = useMemo(
    () => Math.max(
      settings.paceFloor,
      settings.paceBase - score * settings.paceScoreFactor - streak * settings.paceStreakFactor
    ),
    [score, streak, settings]
  );

  // Keep scoreRef in sync so endRun always submits the latest score
  useEffect(() => { scoreRef.current = score; }, [score]);

  const playTone = (freq, durationMs = 90, volume = 0.12) => {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || (window).webkitAudioContext;
    if (!Ctx) return;
    const ctx = audioCtxRef.current || new Ctx();
    audioCtxRef.current = ctx;
    ctx.resume?.();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  };

  const flashCell = (cell, type) => {
    if (cell == null) return;
    if (flashTimeoutsRef.current[cell]) clearTimeout(flashTimeoutsRef.current[cell]);
    setFlashMap((prev) => ({ ...prev, [cell]: type }));
    flashTimeoutsRef.current[cell] = setTimeout(() => {
      setFlashMap((prev) => { const next = { ...prev }; delete next[cell]; return next; });
    }, FLASH_DURATION);
  };

  const spawnPop = (cellIdx, text) => {
    const id = ++popIdRef.current;
    const col = cellIdx % grid.cols;
    const row = Math.floor(cellIdx / grid.cols);
    const x = ((col + 0.5) / grid.cols) * 100;
    const y = ((row + 0.5) / grid.rows) * 100;
    setPops((prev) => [...prev, { id, text, x, y }]);
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
    const totalHits     = hitsRef.current;
    const totalMisses   = missesRef.current;
    const totalAttempts = totalHits + totalMisses;
    onFinish?.({
      score:       scoreRef.current,
      playerName,
      mode,
      hits:        totalHits,
      misses:      totalMisses,
      accuracy:    totalAttempts > 0 ? Math.round((totalHits / totalAttempts) * 100) : null,
      fastestHit:  fastestHitRef.current,
      avgReaction: totalHits > 0 ? Math.round(totalReactionRef.current / totalHits) : null,
      maxStreak:   maxStreakRef.current,
    });
  };

  // FIX: use timeLeftRef for synchronous access — the old pattern (reading a local var
  // set inside setTimeLeft's updater) was broken because setState is async/batched,
  // so `ended` was always false and endRun() was never called from here.
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
      return next;
    });
  };

  const reset = () => {
    if (!playerName || playerName.trim().length === 0) return;
    finishedRef.current = false;
    const startT = settings.startTime;
    timeLeftRef.current = startT;
    scoreRef.current = 0;
    hitsRef.current = 0;
    missesRef.current = 0;
    fastestHitRef.current = null;
    totalReactionRef.current = 0;
    maxStreakRef.current = 0;
    setStatus('playing');
    setTimeLeft(startT);
    setScore(0);
    setStreak(0);
    setMisses(0);
    setHits(0);
    setFastestHit(null);
    setTotalReactionMs(0);
    setPops([]);
    setComboMsg('');
    setFlashMap({});
    const next = pickCell(-1, [], cellCount);
    spawnTimeRef.current = performance.now();
    setActiveCell(next);
    setHazardCell(settings.hazardChance > 0 && Math.random() < settings.hazardChance
      ? pickCell(next, [next], cellCount)
      : null);
    playTone(640, 120, 0.16);
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Miss timeout — restarts whenever activeCell or difficultyWindow changes
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const timeout = setTimeout(() => registerMiss(), difficultyWindow);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeCell, difficultyWindow]);

  // FIX: was missing dependency array — re-created on every render, hammering addEventListener
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if ((status === 'idle' || status === 'done') && playerName?.trim()) reset();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (status === 'playing') setStatus('paused');
        else if (status === 'paused') setStatus('playing');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup flash + combo timers on unmount
  useEffect(() => () => {
    Object.values(flashTimeoutsRef.current).forEach(clearTimeout);
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
  }, []);

  // Reset game when difficulty changes
  useEffect(() => {
    finishedRef.current = false;
    const startT = settings.startTime;
    timeLeftRef.current = startT;
    scoreRef.current = 0;
    hitsRef.current = 0;
    missesRef.current = 0;
    fastestHitRef.current = null;
    totalReactionRef.current = 0;
    maxStreakRef.current = 0;
    setStatus('idle');
    setTimeLeft(startT);
    setScore(0);
    setStreak(0);
    setMisses(0);
    setHits(0);
    setFastestHit(null);
    setTotalReactionMs(0);
    setPops([]);
    setComboMsg('');
    setFlashMap({});
    setActiveCell(pickCell(-1, [], cellCount));
    setHazardCell(null);
  }, [settings, cellCount]);

  // Window resize — update grid dimensions
  useEffect(() => {
    const onResize = () => {
      const next = getGrid();
      setGrid((prev) => (prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const registerMiss = () => {
    if (status !== 'playing') return;
    setStreak(0);
    setMisses((m) => m + 1);
    missesRef.current += 1;
    flashCell(activeCell, 'miss');
    playTone(260, 120, 0.12);
    const ended = applyTimePenalty(settings.missPenalty);
    if (!ended) spawnNewTarget();
  };

  const resumeGame = () => { if (status === 'paused') { setStatus('playing'); playTone(520, 120, 0.1); } };

  const registerHit = (cellIndex) => {
    if (status !== 'playing') return;

    if (cellIndex === hazardCell) {
      flashCell(cellIndex, 'hazard');
      playTone(140, 160, 0.14);
      setHazardCell(null);
      setStreak(0);
      missesRef.current += 1;
      setScore((s) => { const v = Math.max(s - 10, 0); scoreRef.current = v; return v; });
      const ended = applyTimePenalty(settings.missPenalty + 1);
      if (!ended) spawnNewTarget();
      return;
    }

    if (cellIndex !== activeCell) {
      setStreak(0);
      missesRef.current += 1;
      flashCell(cellIndex, 'miss');
      playTone(210, 110, 0.12);
      // FIX: was `|| 2.5` which would fall through on wrongClickPenalty=0; use ?? instead
      applyTimePenalty(settings.wrongClickPenalty ?? 2.5);
      if (navigator?.vibrate) navigator.vibrate(70);
      return;
    }

    const reaction = performance.now() - spawnTimeRef.current;

    // FIX: was setLastHitSpeed on every hit — showed the last hit not the fastest.
    // Now track the minimum reaction across the entire run.
    const reactionRounded = Math.round(reaction);
    setFastestHit((prev) => (prev === null ? reactionRounded : Math.min(prev, reactionRounded)));
    setTotalReactionMs((prev) => prev + reaction);
    setHits((prev) => prev + 1);
    // Sync to refs so endRun reads correct values at game-over time
    hitsRef.current += 1;
    totalReactionRef.current += reaction;
    if (fastestHitRef.current === null || reactionRounded < fastestHitRef.current) {
      fastestHitRef.current = reactionRounded;
    }

    flashCell(cellIndex, 'hit');
    playTone(760 - Math.min(reaction, 900) / 3, 90, 0.12);

    const speedBonus = Math.max(2, Math.round((1200 - reaction) / 30));
    const streakBonus = Math.max(0, streak - 1) * 4;
    const gained = 15 + speedBonus + streakBonus;

    setScore((s) => { const v = Math.max(s + gained, 0); scoreRef.current = v; return v; });
    spawnPop(cellIndex, `+${gained}`);

    const newStreak = streak + 1;
    setStreak(newStreak);
    if (newStreak > maxStreakRef.current) maxStreakRef.current = newStreak;
    showCombo(newStreak);

    const timeReward = Math.max(
      settings.rewardFloor,
      1.25 - reaction / settings.rewardSlope - streak * settings.rewardStreakFactor
    );
    const gain = Math.max(settings.minGain, timeReward + settings.rewardBonus);
    const newTime = clamp(timeLeftRef.current + gain, 0, settings.timeRewardCap);
    timeLeftRef.current = newTime;
    setTimeLeft(newTime);

    spawnNewTarget();
  };

  const totalAttempts = hits + misses;
  const accuracy = totalAttempts > 0 ? Math.round((hits / totalAttempts) * 100) : null;
  const avgReaction = hits > 0 ? Math.round(totalReactionMs / hits) : null;
  const isNewBest = status === 'done' && personalBest > 0 && score > personalBest;
  const isFirstBest = status === 'done' && personalBest === 0 && score > 0;

  // FIX: timebar shows surplus time (above startTime) in a distinct color
  const timebarBanked = timeLeft > settings.startTime;

  return (
    <div className="game-panel">
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
          {personalBest > 0 && (
            <p className="value small pb-line">PB {personalBest}</p>
          )}
          <div className="timebar">
            <div
              className={`timebar-fill${timebarBanked ? ' timebar-fill--banked' : ''}`}
              style={{ width: `${Math.min(100, (timeLeft / settings.startTime) * 100)}%` }}
            />
          </div>
          <p className="value small">{timeLeft.toFixed(1)}s</p>
        </div>
      </div>

      <div
        className="arena"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
      >
        {[...Array(cellCount)].map((_, idx) => (
          <button
            key={idx}
            type="button"
            className={[
              'cell',
              idx === activeCell ? 'cell--active cell--life' : '',
              idx === hazardCell ? 'cell--hazard' : '',
              flashMap[idx] ? `cell--flash-${flashMap[idx]}` : '',
            ].join(' ').trim()}
            style={idx === activeCell ? { '--life': `${difficultyWindow}ms` } : undefined}
            onPointerDown={(e) => { e.preventDefault(); registerHit(idx); }}
            aria-label={idx === activeCell ? 'Active target' : idx === hazardCell ? 'Hazard' : 'Tile'}
          />
        ))}

        {/* Floating score popups */}
        {pops.map((pop) => (
          <div
            key={pop.id}
            className="score-pop"
            style={{ left: `${pop.x}%`, top: `${pop.y}%` }}
          >
            {pop.text}
          </div>
        ))}

        {/* Combo announcement */}
        {comboMsg && <div className="combo-msg">{comboMsg}</div>}

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
                        <p className="new-best-badge">{isFirstBest ? 'FIRST SCORE SET' : 'NEW PERSONAL BEST'}</p>
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
                      Tap green orbs fast.
                      {settings.hazardChance > 0 ? ' Dodge red decoys — they drain time.' : ''}
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

      <div className="footer-row" />
    </div>
  );
}

export default GameBoard;
