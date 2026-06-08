import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import * as wrtc from '@roamhq/wrtc';
import { BrowserManager } from './BrowserManager';
import { ScreencastManager } from './ScreencastManager';
import { VideoSourceManager } from './VideoSourceManager';
import { execSync } from 'child_process';

const PORT = process.env.PORT || 3001;
const BROWSER_SERVICE_URL = process.env.BROWSER_SERVICE_URL || 'http://localhost:3000';
const DOCKER_COMPOSE_DIR = path.resolve(__dirname, '..', '..');
const DOCKER_COMPOSE_FILE = path.join(DOCKER_COMPOSE_DIR, 'docker-compose.yml');

// ── Session state ────────────────────────────────────────
type SessionState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
let sessionState: SessionState = 'stopped';
let browserManager: BrowserManager | null = null;
let screencastManager: ScreencastManager | null = null;
let videoSourceManager: VideoSourceManager | null = null;
let io: SocketIOServer | null = null;
const activePeers: Map<string, wrtc.RTCPeerConnection> = new Map();

async function startBrowserSession() {
  if (sessionState === 'running') return;
  sessionState = 'starting';
  try {
    // Start Docker container with proper port mappings
    try {
      execSync(`docker compose -f "${DOCKER_COMPOSE_FILE}" up -d`, { timeout: 60000, stdio: 'ignore' });
      console.log('[Lifecycle] Docker container started via docker compose.');
    } catch {
      console.log('[Lifecycle] Docker compose not available — assuming browser runs locally.');
    }

    // Wait for browser service to be ready
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const resp = await fetch(`${BROWSER_SERVICE_URL}/health`);
        if (resp.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
      if (i === maxRetries - 1) throw new Error('Browser service not reachable');
    }

    // Connect to Chromium via Playwright CDP
    browserManager = new BrowserManager();
    await browserManager.connect();
    const page = browserManager.getPage()!;
    await page.goto('https://google.com');

    // Inject subtle CSS animation so screencast produces frames continuously
    await page.evaluate(`document.head.appendChild(
      Object.assign(document.createElement('style'), {
        textContent: '@keyframes k{from{opacity:.999}to{opacity:1}}body{animation:k 2s infinite}'
      })
    )`);
    console.log('[Lifecycle] Navigated to https://google.com');

    // Start CDP screencast → WebRTC pipeline
    screencastManager = new ScreencastManager(browserManager);
    videoSourceManager = new VideoSourceManager();

    screencastManager.onFrame(async (frameBuffer: Buffer) => {
      if (!videoSourceManager) return;
      try {
        await videoSourceManager.feedFrame(frameBuffer);
      } catch (err: any) {
        console.error('[Pipeline] feedFrame error:', err.message);
      }
    });

    await screencastManager.start();
    console.log('[Lifecycle] Screencast → WebRTC pipeline running');
    sessionState = 'running';
  } catch (err: any) {
    console.error('[Lifecycle] Failed to start browser session:', err.message);
    sessionState = 'error';
    // Cleanup partial state
    try { await stopBrowserSession(); } catch {}
    throw err;
  }
}

async function stopBrowserSession() {
  if (sessionState === 'stopped') return;
  sessionState = 'stopping';

  // Close all peer connections
  for (const [id, pc] of activePeers) {
    try {
      pc.close();
      console.log(`[Lifecycle] Closed peer connection ${id}`);
    } catch {}
  }
  activePeers.clear();

  // Disconnect all socket clients
  if (io) {
    io.sockets.sockets.forEach(socket => socket.disconnect(true));
  }

  // Stop screencast
  if (screencastManager) {
    try {
      await screencastManager.stop();
    } catch {}
    screencastManager = null;
  }

  // Stop video source
  if (videoSourceManager) {
    try {
      videoSourceManager.stop();
    } catch {}
    videoSourceManager = null;
  }

  // Close Playwright connection
  if (browserManager) {
    try {
      await browserManager.disconnect();
    } catch {}
    browserManager = null;
  }

  // Stop browser container via API
  try {
    await fetch(`${BROWSER_SERVICE_URL}/stop`, { method: 'POST' });
  } catch {}

  // Destroy Docker container
  try {
    execSync(`docker compose -f "${DOCKER_COMPOSE_FILE}" down`, { timeout: 30000, stdio: 'ignore' });
    console.log('[Lifecycle] Docker container stopped via docker compose.');
  } catch {
    console.log('[Lifecycle] Docker compose down skipped (not running in Docker mode).');
  }

  sessionState = 'stopped';
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));

  const server = http.createServer(app);
  io = new SocketIOServer(server, {
    cors: { origin: '*' },
  });

  // ── Browser lifecycle endpoints ────────────────────────
  app.post('/browser/start', async (req, res) => {
    try {
      await startBrowserSession();
      res.json({ status: 'ok', state: sessionState });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message, state: sessionState });
    }
  });

  app.post('/browser/stop', async (req, res) => {
    try {
      await stopBrowserSession();
      res.json({ status: 'ok', state: sessionState });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message, state: sessionState });
    }
  });

  app.post('/browser/restart', async (req, res) => {
    try {
      await stopBrowserSession();
      await startBrowserSession();
      res.json({ status: 'ok', state: sessionState });
    } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message, state: sessionState });
    }
  });

  app.get('/browser/status', (req, res) => {
    res.json({
      state: sessionState,
      peers: activePeers.size,
      connected: browserManager !== null && browserManager.getPage() !== null,
    });
  });

  // ── WebRTC signaling ───────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[Signaling] Viewer connected: ${socket.id}`);

    let pc: wrtc.RTCPeerConnection | null = null;

    if (videoSourceManager) {
      pc = new wrtc.RTCPeerConnection();
      const track = videoSourceManager.createTrack();
      const stream = new wrtc.MediaStream([track]);
      pc.addTrack(track, stream);
      activePeers.set(socket.id, pc);

      pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          socket.emit('ice-candidate', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Signaling] ${socket.id} ICE: ${pc!.iceConnectionState}`);
      };

      // Emit actual viewport so frontend uses correct dimensions
      (async () => {
        let vpWidth = 1920, vpHeight = 1080;
        if (browserManager) {
          const page = browserManager.getPage();
          if (page) {
            const vp = page.viewportSize();
            if (vp) {
              vpWidth = vp.width;
              vpHeight = vp.height;
            } else {
              try {
                const size: any = await page.evaluate('({w: window.innerWidth, h: window.innerHeight})');
                if (size && size.w && size.h) { vpWidth = size.w; vpHeight = size.h; }
              } catch {}
            }
          }
        }
        console.log(`[Signaling] Browser viewport: ${vpWidth}x${vpHeight}`);
        socket.emit('viewport', { width: vpWidth, height: vpHeight });
      })();

      (async () => {
        const offer = await pc!.createOffer();
        console.log(`[Signaling] ${socket.id} SDP offer: type=${offer.type}, length=${offer.sdp.length}`);
        await pc!.setLocalDescription(offer);
        socket.emit('offer', { type: offer.type, sdp: offer.sdp });
      })().catch((err: any) => console.error('[Signaling] createOffer error:', err));

      socket.on('answer', (answer: any) => {
        pc!.setRemoteDescription(new wrtc.RTCSessionDescription(answer))
          .catch((err: any) => console.error('[Signaling] setRemote error:', err));
      });

      socket.on('ice-candidate', (candidate: any) => {
        pc!.addIceCandidate(new wrtc.RTCIceCandidate(candidate))
          .catch((err: any) => console.error('[Signaling] addIce error:', err));
      });
    }

    socket.on('mouse-click', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager?.getPage();
        if (page) {
          await page.mouse.move(data.x, data.y);
          const el: any = await page.evaluate(`(function(x, y) {
            try {
              var target = document.elementFromPoint(x, y);
              if (!target) return { tag: null, reason: 'no element at point' };
              return {
                tag: target.tagName,
                text: (target.textContent || '').substring(0, 100),
                href: target.getAttribute ? target.getAttribute('href') : null,
                id: target.id || null,
                className: (typeof target.className === 'string') ? target.className : null
              };
            } catch(e) { return { error: e.message }; }
          })(${data.x}, ${data.y})`);
          console.log(`[Input] mouse-click at (${data.x}, ${data.y}) → hit:`, JSON.stringify(el));
          await page.mouse.click(data.x, data.y);
        }
      } catch (err: any) {
        console.error('[Input] mouse-click error:', err.message);
      }
    });

    socket.on('mouse-move', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager?.getPage();
        if (page) await page.mouse.move(data.x, data.y);
      } catch (err: any) {
        console.error('[Input] mouse-move error:', err.message);
      }
    });

    socket.on('mouse-down', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager?.getPage();
        if (page) { await page.mouse.move(data.x, data.y); await page.mouse.down(); }
        console.log(`[Input] mouse-down at (${data.x}, ${data.y})`);
      } catch (err: any) {
        console.error('[Input] mouse-down error:', err.message);
      }
    });

    socket.on('mouse-up', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager?.getPage();
        if (page) { await page.mouse.move(data.x, data.y); await page.mouse.up(); }
        console.log(`[Input] mouse-up at (${data.x}, ${data.y})`);
      } catch (err: any) {
        console.error('[Input] mouse-up error:', err.message);
      }
    });

    socket.on('keydown', async (data: { key: string; code: string }) => {
      try {
        const page = browserManager?.getPage();
        if (page) await page.keyboard.down(data.key);
        console.log(`[Input] keydown: ${data.key}`);
      } catch (err: any) {
        console.error('[Input] keydown error:', err.message);
      }
    });

    socket.on('keyup', async (data: { key: string; code: string }) => {
      try {
        const page = browserManager?.getPage();
        if (page) await page.keyboard.up(data.key);
        console.log(`[Input] keyup: ${data.key}`);
      } catch (err: any) {
        console.error('[Input] keyup error:', err.message);
      }
    });

    socket.on('scroll', async (data: { deltaX: number; deltaY: number }) => {
      try {
        const bm = browserManager;
        if (bm) await bm.scroll(data.deltaY);
        console.log(`[Input] scroll deltaY: ${data.deltaY}`);
      } catch (err: any) {
        console.error('[Input] scroll error:', err.message);
      }
    });

    socket.on('navigate', async (data: { url: string }) => {
      try {
        const page = browserManager?.getPage();
        if (page) {
          await page.goto(data.url, { waitUntil: 'load' });
          console.log(`[Input] navigate to: ${data.url}`);
        }
      } catch (err: any) {
        console.error('[Input] navigate error:', err.message);
      }
    });

    socket.on('resize', async (data: { width: number; height: number }) => {
      try {
        const page = browserManager?.getPage();
        if (page) {
          await page.setViewportSize({ width: data.width, height: data.height });
          // Update screencast max dimensions
          if (screencastManager) {
            await screencastManager.stop();
            await screencastManager.start();
          }
          // Broadcast new viewport to all connected clients
          io?.emit('viewport', { width: data.width, height: data.height });
          console.log(`[Input] viewport resized to: ${data.width}x${data.height}`);
        }
      } catch (err: any) {
        console.error('[Input] resize error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Signaling] Viewer disconnected: ${socket.id}`);
      activePeers.delete(socket.id);
      if (pc) pc.close();
    });
  });

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Open http://localhost:${PORT} in your browser`);
    console.log(`[Server] Click "Start Browser" in the UI to begin.`);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
