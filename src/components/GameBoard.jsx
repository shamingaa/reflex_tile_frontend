import React, { useEffect, useMemo, useRef, useState } from 'react';

const FLASH_DURATION = 180;

const getGrid = () => {
  if (typeof window === 'undefined') return { cols: 5, rows: 5 };
  return window.innerWidth <= 540 ? { cols: 4, rows: 4 } : { cols: 5, rows: 5 };
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
    hazardChance: 0,
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
    hazardChance: 0,
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

function GameBoard({ playerName, mode, difficulty = 'normal', onFinish }) {
  const [grid, setGrid] = useState(getGrid());
  const cellCount = grid.cols * grid.rows;
  const [status, setStatus] = useState('idle');
  const [timeLeft, setTimeLeft] = useState(DIFFICULTY[difficulty]?.startTime || DIFFICULTY.normal.startTime);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [misses, setMisses] = useState(0);
  const [activeCell, setActiveCell] = useState(() => pickCell(-1, [], cellCount));
  const [hazardCell, setHazardCell] = useState(null);
  const [flashMap, setFlashMap] = useState({});
  const [lastHitSpeed, setLastHitSpeed] = useState(null);
  const spawnTimeRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const scoreRef = useRef(score);
  const flashTimeoutsRef = useRef({});
  const audioCtxRef = useRef(null);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const settings = useMemo(() => DIFFICULTY[difficulty] || DIFFICULTY.normal, [difficulty]);

  const difficultyWindow = useMemo(
    () => Math.max(settings.paceFloor, settings.paceBase - score * settings.paceScoreFactor - streak * settings.paceStreakFactor),
    [score, streak, settings]
  );

  const reset = () => {
    if (!playerName || playerName.trim().length === 0) return;
    finishedRef.current = false;
    setStatus('playing');
    setTimeLeft(settings.startTime);
    setScore(0);
    setStreak(0);
    setMisses(0);
    setFlashMap({});
    const next = pickCell(-1, [], cellCount);
    spawnTimeRef.current = performance.now();
    setActiveCell(next);
    setHazardCell(settings.hazardChance > 0 && Math.random() < settings.hazardChance ? pickCell(next, [next], cellCount) : null);
    setLastHitSpeed(null);
    playTone(640, 120, 0.16);
  };

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        const next = +(prev - 0.1).toFixed(2);
        if (next <= 0) {
          clearInterval(id);
          endRun();
          return 0;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const timeout = setTimeout(() => {
      registerMiss();
    }, difficultyWindow);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeCell, difficultyWindow]);

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
  });

  useEffect(() => () => {
    Object.values(flashTimeoutsRef.current).forEach((id) => clearTimeout(id));
  }, []);

  useEffect(() => {
    if (status === 'playing' && timeLeft <= 0) {
      endRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, status]);

  useEffect(() => {
    finishedRef.current = false;
    setStatus('idle');
    setTimeLeft(settings.startTime);
    setScore(0);
    setStreak(0);
    setMisses(0);
    setFlashMap({});
    setActiveCell(pickCell(-1, [], cellCount));
    setHazardCell(null);
  }, [settings, cellCount]);

  useEffect(() => {
    const onResize = () => {
      const next = getGrid();
      setGrid((prev) => (prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const applyTimePenalty = (amount) => {
    let ended = false;
    setTimeLeft((t) => {
      const next = clamp(t - amount, 0, 999);
      if (next <= 0) ended = true;
      return next;
    });
    if (ended) {
      endRun();
      return true;
    }
    return false;
  };

  const playTone = (freq, durationMs = 90, volume = 0.12) => {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
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
    if (flashTimeoutsRef.current[cell]) {
      clearTimeout(flashTimeoutsRef.current[cell]);
    }
    setFlashMap((prev) => ({ ...prev, [cell]: type }));
    flashTimeoutsRef.current[cell] = setTimeout(() => {
      setFlashMap((prev) => {
        const next = { ...prev };
        delete next[cell];
        return next;
      });
    }, FLASH_DURATION);
  };

  const spawnNewTarget = () => {
    setActiveCell((prev) => {
      const next = pickCell(prev, [], cellCount);
      spawnTimeRef.current = performance.now();
      setHazardCell(Math.random() < settings.hazardChance ? pickCell(next, [next], cellCount) : null);
      return next;
    });
  };

  const endRun = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setStatus('done');
    onFinish?.({ score: scoreRef.current, playerName, mode });
  };

  const registerMiss = () => {
    if (status !== 'playing') return;
    setStreak(0);
    setMisses((m) => m + 1);
    flashCell(activeCell, 'miss');
    playTone(260, 120, 0.12);
    const ended = applyTimePenalty(settings.missPenalty);
    if (!ended) spawnNewTarget();
  };

  const pauseGame = () => {
    if (status !== 'playing') return;
    setStatus('paused');
    playTone(440, 120, 0.1);
  };

  const resumeGame = () => {
    if (status !== 'paused') return;
    setStatus('playing');
    playTone(520, 120, 0.1);
  };

  const registerHit = (cellIndex) => {
    if (status !== 'playing') return;
    if (cellIndex === hazardCell) {
      flashCell(cellIndex, 'hazard');
      playTone(140, 160, 0.14);
      setHazardCell(null);
      setStreak(0);
      setScore((s) => Math.max(s - 10, 0));
      const ended = applyTimePenalty(settings.missPenalty + 1);
      if (!ended) spawnNewTarget();
      return;
    }
    if (cellIndex !== activeCell) {
      setStreak(0);
      flashCell(cellIndex, 'miss');
      playTone(210, 110, 0.12);
      applyTimePenalty(settings.wrongClickPenalty || 2.5);
      if (navigator?.vibrate) navigator.vibrate(70);
      return;
    }

    const reaction = performance.now() - spawnTimeRef.current;
    setLastHitSpeed(Math.round(reaction));
    flashCell(cellIndex, 'hit');
    playTone(760 - Math.min(reaction, 900) / 3, 90, 0.12);

    setScore((s) => {
      const speedBonus = Math.max(2, Math.round((1200 - reaction) / 30));
      const streakBonus = Math.max(0, streak - 1) * 4;
      const newScore = s + 15 + speedBonus + streakBonus;
      return Math.max(newScore, 0);
    });

    setStreak((s) => s + 1);
    const timeReward = Math.max(
      settings.rewardFloor,
      1.25 - reaction / settings.rewardSlope - streak * settings.rewardStreakFactor
    );
    const gain = Math.max(settings.minGain, timeReward + settings.rewardBonus);
    setTimeLeft((t) => clamp(t + gain, 0, settings.timeRewardCap));
    spawnNewTarget();
  };

  const statusLabel =
    status === 'idle' ? 'Ready' : status === 'playing' ? 'Go!' : status === 'paused' ? 'Paused' : 'Finished';

  return (
    <div className="game-panel">
      <div className="hud hud--compact">
        <div className="hud-block">
          <p className="label">Player</p>
          <p className="value">{playerName}</p>
        </div>
        <div className="hud-block">
          <p className="label">Score</p>
          <p className="value score">{score}</p>
        </div>
        <div className="hud-block">
          <p className="label">Time</p>
          <div className="timebar">
            <div
              className="timebar-fill"
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
            className={`cell ${idx === activeCell ? 'cell--active' : ''} ${
              idx === hazardCell ? 'cell--hazard' : ''
            } ${flashMap[idx] ? `cell--flash-${flashMap[idx]}` : ''} ${
              idx === activeCell ? 'cell--life' : ''
            }`}
            style={idx === activeCell ? { '--life': `${difficultyWindow}ms` } : undefined}
            onPointerDown={() => registerHit(idx)}
            onClick={(e) => {
              e.preventDefault();
              registerHit(idx);
            }}
            aria-label={idx === activeCell ? 'Active target' : idx === hazardCell ? 'Hazard' : 'Tile'}
          />
        ))}
        {status !== 'playing' && (
          <div className="overlay">
            <div className="overlay-card">
              {status === 'paused' ? (
                <>
                  <p className="headline">Paused</p>
                  <p className="sub">Hit Resume or press P/Esc to continue.</p>
                  <button className="cta" onClick={resumeGame}>Resume</button>
                  <p className="sub small">Restart clears your score.</p>
                  <button className="mini-btn ghost" onClick={reset}>Restart</button>
                </>
              ) : (
                <>
                  <p className="headline">{status === 'idle' ? 'Arcade Arena' : 'Run Complete'}</p>
                  <p className="sub">Tap green orbs fast. Avoid red decoys - they drain 5s.</p>
                  <button className="cta" onClick={reset}>
                    {status === 'idle' ? 'Start' : 'Play Again (Space)'}
                  </button>
                  {lastHitSpeed && status !== 'idle' && (
                    <p className="sub">Fastest snap: {lastHitSpeed} ms</p>
                  )}
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
