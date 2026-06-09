# Remote Browser Streaming Platform

A Dockerized remote browser platform that streams a headless Chromium instance in real-time using WebRTC, with full interactive control via mouse, keyboard, scrolling, and URL navigation.

Built with **React**, **TypeScript**, **Node.js**, **Playwright**, **Chrome DevTools Protocol (CDP)**, and **WebRTC**.

---

## Demo

### Features Demonstrated

- Start / Stop browser lifecycle
- Live browser streaming via WebRTC
- URL navigation
- Mouse clicks and movement
- Keyboard input
- Scrolling
- Dynamic resolution switching

### Demo Video

<!-- [Add Loom / YouTube link here] -->

---

## Screenshots

<!-- Create a `docs/screenshots/` directory and add images: -->

### Browser Viewer

![viewer](docs/screenshots/viewer.png)

### Browser Navigation

![navigation](docs/screenshots/navigation.png)

### Streaming Session

![streaming](docs/screenshots/streaming.png)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  <video> element  │  Socket.IO Client                │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────┘
                             │ Socket.IO (mouse, keyboard, scroll, resize)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Backend (server)                  │
│                                                             │
│  ┌─────────────────┐  ┌────────────────────────────────┐   │
│  │  BrowserManager  │  │  ScreencastManager             │   │
│  │  (Playwright)    │  │  (CDP Page.startScreencast)    │   │
│  └────────┬────────┘  └──────────────┬─────────────────┘   │
│           │                          │ JPEG frames          │
│           │                          ▼                      │
│           │              ┌────────────────────────┐         │
│           │              │  VideoSourceManager     │         │
│           │              │  Sharp → I420 → WebRTC │         │
│           │              └───────────┬────────────┘         │
│           │                          │ RTCVideoSource       │
│           │                          ▼                      │
│           │              ┌────────────────────────┐         │
│           │              │  RTCPeerConnection     │         │
│           │              └───────────┬────────────┘         │
└───────────┼──────────────────────────┼──────────────────────┘
            │ CDP                     │ WebRTC
            ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Chromium Service (Docker)                  │
│                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │   Chromium (headless) │    │  socat (port 9222→9223) │   │
│  │   --remote-debugging  │    └──────────────────────────┘   │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Streaming Flow

```
Chromium (headless)
    │
    ▼
CDP Page.startScreencast()   ──►   JPEG frames at ~30 fps
    │
    ▼
Sharp decode + resize
    │
    ▼
RGBA → I420 color conversion
    │
    ▼
RTCVideoSource.onFrame()
    │
    ▼
WebRTC PeerConnection (via @roamhq/wrtc)
    │
    ▼
Frontend <video> element
```

---

## Browser Control Flow

```
User click/keyboard/scroll on frontend
    │
    ▼
Socket.IO event emitted to server
    │
    ▼
Playwright mouse.keyboard.page API
    │
    ▼
Chromium processes the input
    │
    ▼
Page updates visually
    │
    ▼
CDP emits new screencast frame
    │
    ▼
WebRTC stream updated
```

---

## Features

### Browser Lifecycle

- **Start** — launches Docker container with headless Chromium and socat proxy
- **Stop** — cleanly tears down container, peer connections, and socket clients
- **Status** — real-time health monitoring of the browser session
- **Restart** — full lifecycle recycle

### Streaming

- WebRTC-based low-latency video streaming
- CDP screencast frames decoded via Sharp and converted to I420
- FPS monitoring and metrics
- Dynamic viewport resolution switching (720p → 4K)

### Browser Interaction

- Mouse clicks, movement, and scroll events
- Keyboard input (including modifier keys)
- URL navigation with page load waiting
- Real-time coordinate mapping from video element to browser viewport

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Socket.IO Client |
| **Backend** | Node.js, Express 5, TypeScript, Socket.IO 4 |
| **Browser Automation** | Playwright 1.44, Chrome DevTools Protocol (CDP) |
| **Video Processing** | Sharp (JPEG decode/resize), @roamhq/wrtc (WebRTC native) |
| **Streaming** | WebRTC via @roamhq/wrtc (RTCVideoSource) |
| **Infrastructure** | Docker, Docker Compose, socat |
| **Testing** | ts-node, Playwright test scripts |

---

## Project Concepts

### Chrome DevTools Protocol (CDP)

CDP is a low-level protocol exposed by Chromium that allows external programs to inspect and control the browser. Unlike high-level APIs, CDP gives direct access to internal browser domains — screencasting, network inspection, performance profiling, and more.

In this project, CDP is used for:

- Connecting Playwright to an already running Chromium instance
- Starting browser screencasting (`Page.startScreencast`)
- Receiving rendered browser frames as JPEG
- Controlling browser behavior remotely

```
Chromium
    ↓
CDP
    ↓
Playwright / ScreencastManager
```

### WebRTC

WebRTC (Web Real-Time Communication) is a protocol for real-time audio, video, and data transmission between peers with built-in NAT traversal (ICE/STUN/TURN) and low-latency delivery.

In this project, WebRTC is used to stream browser frames from the backend to the frontend.

Why WebRTC over HTTP/WebSocket?

- **Low latency** — designed for sub-second real-time media
- **Frame-level delivery** — no JPEG encode/decode overhead on every frame
- **Adaptive bitrate** — built-in congestion control

```
CDP Frames (JPEG)
    ↓
RTCVideoSource
    ↓
WebRTC PeerConnection
    ↓
Browser <video> Element
```

### Playwright

Playwright is a browser automation framework that supports Chromium, Firefox, and WebKit through a unified API.

In this project it acts as the control layer connecting the backend to Chromium over CDP.

- `page.mouse.move/click/down/up` — mouse interaction
- `page.keyboard.down/up` — keyboard input
- `page.goto` — URL navigation
- `page.setViewportSize` — resolution changes
- `page.context().newCDPSession(page)` — raw CDP access for screencasting

```
Mouse Click → Playwright Mouse API → Chromium
Keyboard    → Playwright Keyboard API → Chromium
Navigation  → Playwright Page API → Chromium
```

### Headless Browser

A headless browser runs without a visible graphical interface. The Chromium instance in this project runs in `--headless=new` mode inside Docker.

Benefits:

- **Lower resource usage** — no GPU or display server needed
- **Easier deployment** — no X11 or Wayland dependencies
- **CI/CD friendly** — works in containerized and server environments

### Docker & socat

Docker packages the application and its dependencies into an isolated container. The Chromium service uses `mcr.microsoft.com/playwright` as its base image with Chromium pre-installed.

**socat** is a UNIX tool that forwards TCP connections from one port to another. It sits between the host and Chromium:

```
Host port 9222 → socat → Chromium debug port 9223
```

This allows the Playwright connection URL (`http://localhost:9222`) to remain stable even if Chromium's debug port changes, and adds a thin isolation layer.

### Screencasting via CDP

CDP's `Page.startScreencast()` continuously emits JPEG-encoded frames of the rendered page. This is the foundation of the browser stream.

```
Rendered Browser
    ↓
Page.startScreencast({ format: 'jpeg', quality: 95, maxWidth: 1920 })
    ↓
JPEG Frames (base64) at configurable interval
    ↓
WebRTC Pipeline
```

A key limitation: `Page.startScreencast` only emits frames when the page visually changes. Static pages produce no frames, which is why a continuous rendering trigger is needed.

### RGBA → I420 (Color Space Conversion)

WebRTC's `RTCVideoSource` expects raw video frames in **I420** (also called IYUV) planar format — the standard for YUV 4:2:0 video. CDP provides frames as JPEG (compressed RGB).

The conversion pipeline:

```
JPEG (compressed, 3 channels)
    ↓
Sharp decode + resize (produces RGBA, 4 channels)
    ↓
rgbaToI420() (packs Y, U, V planes)
    ↓
I420 Uint8Array (YUV 4:2:0 planar)
    ↓
RTCVideoSource.onFrame()
```

This was one of the core technical challenges — JPEG decompression, RGBA packing, planar conversion, and memory management all happen per-frame under real-time constraints.

### Sharp (Image Processing)

[Sharp](https://sharp.pixelplumbing.com/) is a high-performance Node.js library for image processing, backed by libvips. It is used to decode incoming JPEG frames and resize them to the target output resolution.

```
sharp(jpegBuffer)
  .resize(width, height, { fit: 'fill' })
  .ensureAlpha()
  .raw()
  .toBuffer()
```

Sharp was chosen over alternatives like `jpeg-js` or `canvas` because it is significantly faster — important when processing 30+ frames per second.

### @roamhq/wrtc (Native WebRTC)

[@roamhq/wrtc](https://github.com/roamhq/wrtc) is a Node.js native addon that exposes the WebRTC API (`RTCPeerConnection`, `RTCVideoSource`, etc.) without requiring a browser. It replaces the abandoned `wrtc` package.

Key components used:

- **`RTCVideoSource`** — injects raw video frames (I420) into a WebRTC stream
- **`RTCPeerConnection`** — manages the WebRTC handshake and media transport
- **`rgbaToI420()`** — color space conversion utility

### Socket.IO (Signaling & Event Transport)

[Socket.IO](https://socket.io/) is a real-time bidirectional communication library built on WebSocket with fallback transport.

In this project, it handles two distinct responsibilities:

1. **WebRTC Signaling** — exchange of SDP offers/answers and ICE candidates between backend and frontend
2. **Input Events** — transmission of mouse clicks, mouse moves, keyboard input, scroll, and resize commands from the frontend to the backend

```
Frontend                    Backend
    │                          │
    ├─ offer (SDP) ──────────► │
    │◄── answer (SDP) ────────┤
    ├─ ice-candidate ────────► │
    │◄─ ice-candidate ────────┤
    │                          │
    ├─ mouse-down/move/up ──► │
    ├─ keydown/keyup ────────►│
    ├─ scroll ───────────────►│
    └─ navigate ─────────────►│
```

---

## Engineering Challenges Solved

### 1. Headless Chromium Streaming

CDP's `Page.startScreencast()` only emits frames when the page visually changes. A static page produces no frames, freezing the WebRTC stream.

**Solution:** A lightweight CSS animation is injected on the page during active screencast sessions and removed on stop, ensuring consistent frame generation without permanently modifying the page.

### 2. WebRTC Frame Conversion Pipeline

CDP delivers frames as base64-encoded JPEG images, but WebRTC's `RTCVideoSource` requires raw I420 format.

**Pipeline:**
```
JPEG → Sharp decode + resize → RGBA buffer → rgbaToI420() → RTCVideoSource
```

**Backpressure guard:** If frame processing takes longer than the inter-frame interval, excess frames are dropped to prevent unbounded queue growth and OOM.

### 3. Viewport Coordinate Mapping

The browser viewport and the rendered `<video>` element have different dimensions. Raw mouse coordinates must be scaled accurately.

```
Video element (clientX, clientY)
    ↓
Scale by (browserWidth / videoWidth, browserHeight / videoHeight)
    ↓
Playwright page.mouse.move/click/down/up
```

### 4. Browser Lifecycle Management

Dockerized Chromium must start, become healthy, and be torn down cleanly — all while handling concurrent requests.

**Solution:** Health polling replaces hardcoded sleeps — the service polls the CDP debug port until Chromium is actually ready. A lifecycle mutex prevents concurrent start/stop/restart races.

### 5. Session Lifecycle Concurrency

Start/stop/restart API calls and socket disconnect events can race, leading to leaked resources or crashed sessions.

**Solution:** A state machine (`stopped → starting → running → stopping → error`) guarded by a mutex lock serializes all transitions, with proper cleanup in error paths.

---

## Project Structure

```
BLD/
│
├── chromium-service/            # Docker container service
│   ├── src/
│   │   └── index.ts             # Chromium launch, socat proxy, health API
│   ├── Dockerfile               # Playwright Docker image + socat
│   └── package.json
│
├── frontend/                    # React web UI
│   ├── src/
│   │   ├── App.tsx              # Main app: signaling, WebRTC, video, controls
│   │   ├── main.tsx             # React entry point
│   │   └── vite-env.d.ts
│   ├── vite.config.ts
│   └── package.json
│
├── server/                      # Backend signaling + control
│   ├── src/
│   │   ├── server.ts            # Express + Socket.IO server, session lifecycle
│   │   ├── BrowserManager.ts    # Playwright CDP connection management
│   │   ├── ScreencastManager.ts # CDP screencast frame capture + dispatch
│   │   ├── VideoSourceManager.ts# JPEG → I420 → WebRTC pipeline
│   │   ├── test.ts              # Integration test helpers
│   │   ├── test_screencast.ts   # Screencast-only test
│   │   ├── test_fps.ts          # FPS benchmark test
│   │   └── test_webrtc.ts       # WebRTC pipeline test
│   └── package.json
│
├── docker-compose.yml           # Orchestrates chromium-service
├── .gitignore
└── README.md
```

---

## Installation

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for containerized mode)
- npm or yarn

### Clone

```bash
git clone <repository-url>
cd BLD
```

### Install Dependencies

```bash
# Frontend
cd frontend
npm install

# Backend server
cd ../server
npm install

# Chromium service (browser container)
cd ../chromium-service
npm install

cd ..
```

### Environment Variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server HTTP + WebSocket port |
| `BROWSER_SERVICE_URL` | `http://localhost:3000` | Chromium service health endpoint |
| `CHROME_CDP_URL` | `http://localhost:9222` | Playwright CDP connection URL |
| `DEBUG_FRAME_DUMPS` | unset | Set to `true` to save every 100th frame to disk |

---

## Running

### With Docker (recommended)

The server auto-starts the Docker container when you click "Start Browser" in the UI.

```bash
cd server
npm start
```

Then open **http://localhost:3001** and click **Start Browser**.

### Without Docker (local Chromium)

1. Start a Chromium instance manually with remote debugging:
   ```bash
   chromium --headless=new --remote-debugging-port=9222 --no-sandbox
   ```
2. Start the server:
   ```bash
   cd server
   npm start
   ```
3. Open `http://localhost:3001` and click **Start Browser**.

### Development Mode

```bash
# Terminal 1 — frontend dev server with HMR
cd frontend
npm run dev

# Terminal 2 — backend
cd server
npm start
```

---

## Testing

```bash
cd server

# Run all tests
npm test

# Screencast-only test
npm run test:screencast

# FPS benchmark
npm run test:fps

# WebRTC pipeline test
npm run test:webrtc
```

---

## Future Improvements with more time

- Multi-tab support (multiple pages, tab switching)
- Session recording and playback
- Collaborative browser sharing
- AI-powered page summarization
- Browser history replay and navigation
- Authentication and multi-user sessions
- File upload/download passthrough
- Audio streaming via WebRTC

---

## Learnings

Through this project I gained hands-on experience with:

- **Chrome DevTools Protocol** — screencast capture, page evaluation, CDP session management
- **Playwright automation** — CDP-based browser connection, mouse/keyboard control, viewport management
- **WebRTC media pipelines** — `RTCVideoSource`, frame conversion, `RTCPeerConnection` signaling
- **Video frame processing** — JPEG decoding, color space conversion (RGBA → I420), Sharp image processing
- **Dockerized browser infrastructure** — containerized Chromium with socat port proxying, health checks
- **Real-time bidirectional browser interaction** — Socket.IO event forwarding with coordinate mapping
- **Concurrency and lifecycle management** — state machines, mutexes, backpressure, resource cleanup

---

## Final Result

Successfully built a production-grade remote browser platform capable of:

- Launching a Dockerized headless Chromium instance on demand
- Streaming the browser session in real-time using WebRTC at configurable resolutions
- Handling mouse, keyboard, and scroll interactions with accurate coordinate mapping
- Navigating arbitrary websites with reliable page-load waiting
- Gracefully managing the full browser lifecycle (start, stop, restart, error recovery)
- Maintaining consistent frame generation for a smooth streaming experience
