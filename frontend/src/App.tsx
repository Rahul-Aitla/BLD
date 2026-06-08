import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = 'http://localhost:3001';
const BROWSER_WIDTH = 1280;
const BROWSER_HEIGHT = 720;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState('Connecting...');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(performance.now());
  const [fps, setFps] = useState(0);
  const fpsInterval = useRef<ReturnType<typeof setInterval>>();
  const browserW = useRef(BROWSER_WIDTH);
  const browserH = useRef(BROWSER_HEIGHT);

  function convertCoords(e: React.MouseEvent<HTMLVideoElement>) {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const browserX = (mouseX / rect.width) * browserW.current;
    const browserY = (mouseY / rect.height) * browserH.current;
    console.log(`[Coord] mouse=(${Math.round(mouseX)},${Math.round(mouseY)}) container=(${Math.round(rect.width)}x${Math.round(rect.height)}) browser=(${Math.round(browserX)},${Math.round(browserY)}) viewport=${browserW.current}x${browserH.current}`);
    return { x: Math.round(browserX), y: Math.round(browserY) };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLVideoElement>) {
    const coords = convertCoords(e);
    if (!coords) return;
    socketRef.current?.emit('mouse-down', coords);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLVideoElement>) {
    const coords = convertCoords(e);
    if (!coords) return;
    socketRef.current?.emit('mouse-up', coords);
  }

  function handleClick(e: React.MouseEvent<HTMLVideoElement>) {
    const coords = convertCoords(e);
    if (!coords) return;
    socketRef.current?.emit('mouse-click', coords);
  }

  useEffect(() => {
    const socket = io(SIGNALING_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('Connected, waiting for stream...');
    });

    socket.on('offer', async (offer: RTCSessionDescriptionInit) => {
      setStatus('Setting up WebRTC...');
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (event.track.kind === 'video' && videoRef.current) {
          const stream = new MediaStream([event.track]);
          videoRef.current.srcObject = stream;
          setStatus('Streaming');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', event.candidate.toJSON());
        }
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
      try {
        await pcRef.current?.addIceCandidate(candidate);
      } catch {}
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected, reconnecting...');
    });

    socket.on('viewport', (vp: { width: number; height: number }) => {
      browserW.current = vp.width;
      browserH.current = vp.height;
      console.log(`[Viewport] Server browser viewport: ${vp.width}x${vp.height}`);
    });

    fpsInterval.current = setInterval(() => {
      const now = performance.now();
      const dt = now - lastFpsTime.current;
      setFps(Math.round(frameCount.current / (dt / 1000)));
      frameCount.current = 0;
      lastFpsTime.current = now;
    }, 1000);

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      socket.emit('keydown', { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      socket.emit('keyup', { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      socket.emit('scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      clearInterval(fpsInterval.current);
      pcRef.current?.close();
      socket.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

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

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#000',
      position: 'relative', overflow: 'hidden',
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      />
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(0,0,0,0.65)', color: '#0f0',
        padding: '6px 12px', borderRadius: 6,
        fontFamily: 'monospace', fontSize: 13,
        zIndex: 10,
      }}>
        {status}{fps > 0 ? ` | ${fps} FPS` : ''}
      </div>
    </div>
  );
}
