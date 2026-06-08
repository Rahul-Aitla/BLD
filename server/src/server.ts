import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import * as wrtc from '@roamhq/wrtc';
import { BrowserManager } from './BrowserManager';
import { ScreencastManager } from './ScreencastManager';
import { VideoSourceManager } from './VideoSourceManager';

const PORT = process.env.PORT || 3001;

async function main() {
  const app = express();
  app.use(cors());

  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
  });

  // ── Connect to Chromium ────────────────────────────────
  const browserManager = new BrowserManager();
  await browserManager.connect();
  const page = browserManager.getPage()!;
  await page.goto('https://example.com');
  // Inject subtle CSS animation so screencast produces frames continuously
  await page.evaluate(`document.head.appendChild(
    Object.assign(document.createElement('style'), {
      textContent: '@keyframes k{from{opacity:.999}to{opacity:1}}body{animation:k 2s infinite}'
    })
  )`);
  console.log('[Server] Navigated to https://example.com');

  // ── Start CDP screencast → WebRTC pipeline ─────────────
  const screencastManager = new ScreencastManager(browserManager);
  const videoSourceManager = new VideoSourceManager();

  screencastManager.onFrame(async (frameBuffer: Buffer) => {
    try {
      await videoSourceManager.feedFrame(frameBuffer);
    } catch (err: any) {
      console.error('[Pipeline] feedFrame error:', err.message);
    }
  });

  await screencastManager.start();
  console.log('[Server] Screencast → WebRTC pipeline running');

  // ── WebRTC signaling ───────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[Signaling] Viewer connected: ${socket.id}`);

    const pc = new wrtc.RTCPeerConnection();
    const track = videoSourceManager.createTrack();
    const stream = new wrtc.MediaStream([track]);
    pc.addTrack(track, stream);

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        socket.emit('ice-candidate', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Signaling] ${socket.id} ICE: ${pc.iceConnectionState}`);
    };

    // Emit actual viewport so frontend uses correct dimensions
    (async () => {
      let vpWidth = 1280, vpHeight = 720;
      const vp = page.viewportSize();
      if (vp) {
        vpWidth = vp.width;
        vpHeight = vp.height;
      } else {
        // Fallback: measure from inside the browser
        try {
          const size: any = await page.evaluate('({w: window.innerWidth, h: window.innerHeight})');
          if (size && size.w && size.h) { vpWidth = size.w; vpHeight = size.h; }
        } catch {}
      }
      console.log(`[Signaling] Browser viewport: ${vpWidth}x${vpHeight}`);
      socket.emit('viewport', { width: vpWidth, height: vpHeight });
    })();

    (async () => {
      const offer = await pc.createOffer();
      console.log(`[Signaling] ${socket.id} SDP offer:\n${offer.sdp}`);
      await pc.setLocalDescription(offer);
      socket.emit('offer', { type: offer.type, sdp: offer.sdp });
    })().catch((err: any) => console.error('[Signaling] createOffer error:', err));

    socket.on('answer', (answer: any) => {
      pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer))
        .catch((err: any) => console.error('[Signaling] setRemote error:', err));
    });

    socket.on('ice-candidate', (candidate: any) => {
      pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate))
        .catch((err: any) => console.error('[Signaling] addIce error:', err));
    });

    socket.on('mouse-click', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager.getPage();
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
        const page = browserManager.getPage();
        if (page) await page.mouse.move(data.x, data.y);
      } catch (err: any) {
        console.error('[Input] mouse-move error:', err.message);
      }
    });

    socket.on('mouse-down', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager.getPage();
        if (page) { await page.mouse.move(data.x, data.y); await page.mouse.down(); }
        console.log(`[Input] mouse-down at (${data.x}, ${data.y})`);
      } catch (err: any) {
        console.error('[Input] mouse-down error:', err.message);
      }
    });

    socket.on('mouse-up', async (data: { x: number; y: number }) => {
      try {
        const page = browserManager.getPage();
        if (page) { await page.mouse.move(data.x, data.y); await page.mouse.up(); }
        console.log(`[Input] mouse-up at (${data.x}, ${data.y})`);
      } catch (err: any) {
        console.error('[Input] mouse-up error:', err.message);
      }
    });

    socket.on('keydown', async (data: { key: string; code: string }) => {
      try {
        const page = browserManager.getPage();
        if (page) await page.keyboard.down(data.key);
        console.log(`[Input] keydown: ${data.key}`);
      } catch (err: any) {
        console.error('[Input] keydown error:', err.message);
      }
    });

    socket.on('keyup', async (data: { key: string; code: string }) => {
      try {
        const page = browserManager.getPage();
        if (page) await page.keyboard.up(data.key);
        console.log(`[Input] keyup: ${data.key}`);
      } catch (err: any) {
        console.error('[Input] keyup error:', err.message);
      }
    });

    socket.on('scroll', async (data: { deltaX: number; deltaY: number }) => {
      try {
        await browserManager.scroll(data.deltaY);
        console.log(`[Input] scroll deltaY: ${data.deltaY}`);
      } catch (err: any) {
        console.error('[Input] scroll error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Signaling] Viewer disconnected: ${socket.id}`);
      pc.close();
    });
  });

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Open http://localhost:${PORT} in your browser`);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
