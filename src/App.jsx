import React, { useEffect, useState } from 'react';
import GameBoard from './components/GameBoard';
import Leaderboard from './Leaderboard';
import { fetchScores, submitScore } from './api';
import './styles.css';

const DEVICE_KEY = 'arcade_arena_device';
const NAME_KEY = 'arcade_arena_player';

const ensureDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Math.random().toString(16).slice(2, 10)}`;
  localStorage.setItem(DEVICE_KEY, id);
  return id;
};

function App() {
  const [playerName, setPlayerName] = useState('');
  const [deviceId] = useState(() => ensureDeviceId());
  const [mode] = useState('solo');
  const [difficulty, setDifficulty] = useState('normal');
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const loadScores = async (selectedMode = mode) => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchScores(selectedMode);
      setScores(list);
    } catch (err) {
      setError(err.message || 'Failed to load scores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScores(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName && savedName.trim().length > 0) {
      setPlayerName(savedName);
    }
  }, []);

  const handleNameChange = (value) => {
    setPlayerName(value);
    localStorage.setItem(NAME_KEY, value);
  };

  const handleFinish = async ({ score }) => {
    const canPlay = playerName.trim().length > 0;
    if (!canPlay) return;
    try {
      await submitScore({ playerName, score, mode, deviceId });
      loadScores(mode);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Could not save score');
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard?.writeText(deviceId);
      setCopyStatus('ID copied');
    } catch (err) {
      console.error('Copy failed', err);
      setCopyStatus('Copy failed');
    }
    setTimeout(() => setCopyStatus(''), 1500);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Reflex Race</p>
          <h1>Arcade Arena</h1>
        </div>
        <button className="menu-btn" onClick={() => setDrawerOpen((v) => !v)}>
          ☰
        </button>
      </header>

      <p className="lede lede--tight">Tap the glowing orb before it fades. Keep the timer alive to climb the board.</p>

      <main className="stack">
        <GameBoard
          playerName={playerName}
          mode={mode}
          deviceId={deviceId}
          difficulty={difficulty}
          onFinish={handleFinish}
        />
      </main>

      <div className={`drawer ${drawerOpen ? 'drawer--open' : ''}`}>
        <div className="drawer__header">
          <h3>Settings & Board</h3>
          <button className="menu-btn ghost" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="drawer__content">
          <div className="card">
            <label className="field">
              <span>Player tag (saved on this device)</span>
              <input
                value={playerName}
                onChange={(e) => handleNameChange(e.target.value)}
                maxLength={32}
              />
            </label>
            <div className="field inline">
              <span>Player ID</span>
              <div className="id-row">
                <code className="device-id">{deviceId}</code>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={handleCopyId}
                  aria-label="Copy player ID"
                >
                  Copy
                </button>
              </div>
              {copyStatus && <p className="copy-status">{copyStatus}</p>}
            </div>
            {/* Mode hidden; default solo */}
            <label className="field inline">
              <span>Difficulty</span>
              <div className="segmented">
                <button className={difficulty === 'normal' ? 'active' : ''} onClick={() => setDifficulty('normal')}>
                  Normal
                </button>
                <button className={difficulty === 'hard' ? 'active' : ''} onClick={() => setDifficulty('hard')}>
                  Hard
                </button>
                <button className={difficulty === 'extreme' ? 'active' : ''} onClick={() => setDifficulty('extreme')}>
                  Extreme
                </button>
              </div>
            </label>
            <p className="muted">Space: start / restart. P/Esc: pause.</p>
          </div>

          <Leaderboard
            scores={scores}
            loading={loading}
            error={error}
          />
        </div>
      </div>

      {drawerOpen && <div className="scrim" onClick={() => setDrawerOpen(false)} />}
    </div>
  );
}

export default App;
