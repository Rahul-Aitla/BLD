import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = 'http://localhost:3001';
const BROWSER_WIDTH = 1920;
const BROWSER_HEIGHT = 1080;

const RESOLUTIONS = [
  { label: '1280×720', w: 1280, h: 720 },
  { label: '1366×768', w: 1366, h: 768 },
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '2560×1440', w: 2560, h: 1440 },
  { label: '3840×2160', w: 3840, h: 2160 },
];

type BState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(performance.now());
  const pingStart = useRef(0);
  const browserW = useRef(BROWSER_WIDTH);
  const browserH = useRef(BROWSER_HEIGHT);
  const fpsInterval = useRef<ReturnType<typeof setInterval>>();
  const pingInterval = useRef<ReturnType<typeof setInterval>>();
  const statusCheckRef = useRef<ReturnType<typeof setInterval>>();

  const [status, setStatus] = useState('Connecting...');
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [browserState, setBrowserState] = useState<BState>('stopped');
  const [url, setUrl] = useState('');
  const [resolution, setResolution] = useState(RESOLUTIONS[2]);

  async function checkStatus() {
    try {
      const r = await fetch(`${SIGNALING_URL}/browser/status`);
      const d = await r.json();
      setBrowserState(d.state);
    } catch {}
  }

  const connectSocket = useCallback(() => {
    socketRef.current?.disconnect();
    pcRef.current?.close();
    pcRef.current = null;

    const socket = io(SIGNALING_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('Connected, waiting for stream...');
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected, reconnecting...');
    });

    socket.on('offer', async (offer: RTCSessionDescriptionInit) => {
      setStatus('Setting up WebRTC...');
      pcRef.current?.close();
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (event.track.kind === 'video' && videoRef.current) {
          videoRef.current.srcObject = new MediaStream([event.track]);
          setStatus('Streaming');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', event.candidate.toJSON());
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setStatus(`ICE ${pc.iceConnectionState}`);
        }
      };

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { type: answer.type, sdp: answer.sdp });
    });

    socket.on('ice-candidate', async (candidate: RTCIceCandidateInit) => {
      try { await pcRef.current?.addIceCandidate(candidate); } catch {}
    });

    socket.on('viewport', (vp: { width: number; height: number }) => {
      browserW.current = vp.width;
      browserH.current = vp.height;
    });

    socket.on('pong', () => {
      setLatency(Math.round(performance.now() - pingStart.current));
    });
  }, []);

  // Initial setup
  useEffect(() => {
    checkStatus();
    connectSocket();

    statusCheckRef.current = setInterval(checkStatus, 3000);
    fpsInterval.current = setInterval(() => {
      const now = performance.now();
      const dt = now - lastFpsTime.current;
      setFps(Math.round(frameCount.current / (dt / 1000)));
      frameCount.current = 0;
      lastFpsTime.current = now;
    }, 1000);

    pingInterval.current = setInterval(() => {
      if (socketRef.current?.connected) {
        pingStart.current = performance.now();
        socketRef.current.emit('ping');
      }
    }, 3000);

    return () => {
      clearInterval(statusCheckRef.current);
      clearInterval(fpsInterval.current);
      clearInterval(pingInterval.current);
      pcRef.current?.close();
      socketRef.current?.disconnect();
    };
  }, [connectSocket]);

  // FPS counter
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !('requestVideoFrameCallback' in video)) return;
    let rafId = 0;
    const onFrame: VideoFrameRequestCallback = () => {
      frameCount.current++;
      rafId = (video as any).requestVideoFrameCallback(onFrame);
    };
    rafId = (video as any).requestVideoFrameCallback(onFrame);
    return () => (video as any).cancelVideoFrameCallback?.(rafId);
  }, [status]);

  // Keyboard and scroll listeners
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      socketRef.current?.emit('keydown', {
        key: e.key, code: e.code,
        shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey,
      });
    }
    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      socketRef.current?.emit('keyup', {
        key: e.key, code: e.code,
        shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey,
      });
    }
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      socketRef.current?.emit('scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  function convertCoords(e: React.MouseEvent<HTMLVideoElement>) {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    return {
      x: Math.round((mouseX / rect.width) * browserW.current),
      y: Math.round((mouseY / rect.height) * browserH.current),
    };
  }

  function handleNavigate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
    socketRef.current?.emit('navigate', { url: targetUrl });
  }

  function handleResize(r: typeof resolution) {
    setResolution(r);
    socketRef.current?.emit('resize', { width: r.w, height: r.h });
  }

  async function handleBrowserAction(action: 'start' | 'stop' | 'restart') {
    try {
      const r = await fetch(`${SIGNALING_URL}/browser/${action}`, { method: 'POST' });
      const d = await r.json();
      setBrowserState(d.state);

      if (action === 'start' || action === 'restart') {
        // Poll until state is 'running', then reconnect socket for WebRTC
        const poll = setInterval(async () => {
          try {
            const r2 = await fetch(`${SIGNALING_URL}/browser/status`);
            const d2 = await r2.json();
            setBrowserState(d2.state);
            if (d2.state === 'running') {
              clearInterval(poll);
              connectSocket();
            }
          } catch {}
        }, 1000);
      } else if (action === 'stop') {
        pcRef.current?.close();
        pcRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setStatus('Stopped');
      }
    } catch {}
  }

  const isActive = browserState === 'running';
  const isConnecting = status === 'Connecting...' || status === 'Connected, waiting for stream...' || status === 'Setting up WebRTC...';
  const showSpinner = isConnecting || browserState === 'starting' || browserState === 'stopping';

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: '#000', overflow: 'hidden',
    }}>
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: 'rgba(30,30,36,0.92)',
        borderBottom: '1px solid #444',
        flexShrink: 0, zIndex: 20,
        fontFamily: 'monospace', fontSize: 13, color: '#ccc',
        flexWrap: 'wrap',
      }}>
        <button onClick={() => handleBrowserAction('start')} disabled={isActive || browserState === 'starting'}
          style={{ padding: '3px 10px', cursor: isActive ? 'not-allowed' : 'pointer', background: isActive ? '#333' : '#2a7', border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }}>
          ▶ Start
        </button>
        <button onClick={() => handleBrowserAction('stop')} disabled={!isActive}
          style={{ padding: '3px 10px', cursor: !isActive ? 'not-allowed' : 'pointer', background: !isActive ? '#333' : '#c33', border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }}>
          ■ Stop
        </button>
        <button onClick={() => handleBrowserAction('restart')}
          style={{ padding: '3px 10px', cursor: 'pointer', background: '#555', border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }}>
          ↻ Restart
        </button>

        <span style={{ color: '#888' }}>|</span>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: browserState === 'running' ? '#4c4' : browserState === 'error' ? '#c44' : '#aa0',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
          {browserState}
        </span>

        <span style={{ color: '#888' }}>|</span>

        <form onSubmit={handleNavigate} style={{ display: 'flex', flex: '1 1 200px', gap: 4, minWidth: 120 }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Enter URL…"
            style={{
              flex: 1, padding: '3px 8px', background: '#222', border: '1px solid #555',
              borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: 12,
              outline: 'none', minWidth: 80,
            }}
          />
          <button type="submit" style={{ padding: '3px 10px', background: '#4488cc', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}>
            Go
          </button>
        </form>

        <span style={{ color: '#888' }}>|</span>

        <select
          value={`${resolution.w}x${resolution.h}`}
          onChange={e => {
            const r = RESOLUTIONS.find(x => `${x.w}x${x.h}` === e.target.value) || RESOLUTIONS[2];
            handleResize(r);
          }}
          style={{ padding: '3px 6px', background: '#222', border: '1px solid #555', borderRadius: 4, color: '#fff', fontSize: 12, cursor: 'pointer' }}
        >
          {RESOLUTIONS.map(r => (
            <option key={r.label} value={`${r.w}x${r.h}`}>{r.label}</option>
          ))}
        </select>

        <span style={{ color: '#888' }}>|</span>

        <span>{fps} FPS</span>
        <span style={{ color: '#888' }}>|</span>
        <span>{latency > 0 ? `${latency}ms` : '---'}</span>

        <button onClick={() => { connectSocket(); }}
          style={{ marginLeft: 4, padding: '3px 10px', background: '#555', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}>
          ↺ Reconnect
        </button>
      </div>

      {/* ── Video area ──────────────────────────────────── */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {showSpinner && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 16,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              border: '3px solid #333', borderTopColor: '#4af',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 14 }}>{status}</span>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%', height: '100%',
            objectFit: 'fill',
            opacity: showSpinner ? 0 : 1,
            transition: 'opacity 0.3s',
          }}
          onMouseDown={e => { const c = convertCoords(e); if (c) socketRef.current?.emit('mouse-down', c); }}
          onMouseUp={e => { const c = convertCoords(e); if (c) socketRef.current?.emit('mouse-up', c); }}
          onClick={e => { const c = convertCoords(e); if (c) socketRef.current?.emit('mouse-click', c); }}
        />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
