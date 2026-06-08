import { CDPSession } from 'playwright';
import { BrowserManager } from './BrowserManager';
import * as fs from 'fs';
import * as path from 'path';

export interface FrameMetadata {
  timestamp?: number;
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  [key: string]: any;
}

export type FrameCallback = (frameData: Buffer, metadata: FrameMetadata) => void | Promise<void>;

export class ScreencastManager {
  private browserManager: BrowserManager;
  private cdpSession: CDPSession | null = null;
  private isScreencasting: boolean = false;
  private callbacks: FrameCallback[] = [];

  // Statistics
  private frameCount = 0;
  private startTime = 0;
  private totalBytes = 0;
  private lastFrameTimestamp = 0;
  
  // Rolling FPS tracking
  private currentFps = 0;
  private lastFpsCalcTime = 0;
  private fpsFrameCount = 0;

  // Folder to save verification frames
  private framesDir: string;

  constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager;
    this.framesDir = path.join(__dirname, '..', 'frames');
    
    this.log('INFO', `Initialized ScreencastManager. Verification frames will save to: ${this.framesDir}`);
    
    // Register to BrowserManager connection lifecycle events
    this.browserManager.on('connected', async () => {
      this.log('INFO', 'BrowserManager reconnected. Checking if screencast should resume...');
      if (this.isScreencasting) {
        this.log('INFO', 'Resuming screencast session...');
        try {
          await this.startScreencastSession();
        } catch (err: any) {
          this.log('ERROR', `Failed to auto-resume screencast: ${err.message || err}`);
        }
      }
    });

    this.browserManager.on('disconnected', () => {
      this.log('WARN', 'BrowserManager disconnected. Cleaning up active CDP session.');
      this.cleanupCdpSession();
    });
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: any) {
    const logObj = {
      timestamp: new Date().toISOString(),
      level,
      component: 'ScreencastManager',
      message,
      ...(meta || {}),
    };
    console.log(JSON.stringify(logObj));
  }

  /**
   * Start the screencast.
   */
  async start(): Promise<void> {
    if (this.isScreencasting) {
      this.log('WARN', 'Screencast is already running.');
      return;
    }
    this.isScreencasting = true;
    
    // Reset stats
    this.frameCount = 0;
    this.totalBytes = 0;
    this.startTime = Date.now();
    this.lastFpsCalcTime = Date.now();
    this.fpsFrameCount = 0;
    this.currentFps = 0;

    // Create frames directory if it doesn't exist
    if (!fs.existsSync(this.framesDir)) {
      fs.mkdirSync(this.framesDir, { recursive: true });
    }

    await this.startScreencastSession();
  }

  /**
   * Internal method to establish the CDP session and start Page.startScreencast.
   */
  private async startScreencastSession(): Promise<void> {
    try {
      this.cleanupCdpSession();

      const page = this.browserManager.getPage();
      if (!page) {
        throw new Error('No active page available in BrowserManager.');
      }

      this.log('INFO', 'Creating new CDPSession...');
      this.cdpSession = await page.context().newCDPSession(page);

      this.log('INFO', 'Enabling Page domain...');
      await this.cdpSession.send('Page.enable');

      // Set up frame listener
      this.cdpSession.on('Page.screencastFrame', (event: any) => {
        this.handleIncomingFrame(event).catch((err) => {
          this.log('ERROR', `Error handling frame event: ${err.message}`);
        });
      });

      this.log('INFO', 'Starting CDP Screencast...');
      await this.cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 1
      });

      this.log('INFO', 'CDP Screencast successfully started.');
    } catch (error: any) {
      this.log('ERROR', `Failed to start screencast session: ${error.message || error}`);
      throw error;
    }
  }

  /**
   * Stop the screencast.
   */
  async stop(): Promise<void> {
    this.isScreencasting = false;
    this.log('INFO', 'Stopping screencast...');
    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Page.stopScreencast');
      } catch (err: any) {
        this.log('WARN', `Error stopping screencast: ${err.message || err}`);
      }
    }
    this.cleanupCdpSession();
    this.log('INFO', 'Screencast stopped.');
  }

  private cleanupCdpSession() {
    if (this.cdpSession) {
      try {
        this.cdpSession.detach();
      } catch (err) {
        // Safe to ignore if already closed
      }
      this.cdpSession = null;
    }
  }

  /**
   * Register a callback to receive every frame buffer and its metadata.
   */
  onFrame(callback: FrameCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Process an incoming frame from CDP.
   */
  private async handleIncomingFrame(event: { data: string; metadata: FrameMetadata; sessionId: number }): Promise<void> {
    try {
      this.frameCount++;
      this.fpsFrameCount++;
      this.lastFrameTimestamp = event.metadata.timestamp || 0;

      // Calculate frame size in bytes
      const frameBuffer = Buffer.from(event.data, 'base64');
      const frameSize = frameBuffer.length;
      this.totalBytes += frameSize;

      // Calculate rolling FPS
      const now = Date.now();
      const elapsedMs = now - this.lastFpsCalcTime;
      if (elapsedMs >= 1000) {
        this.currentFps = (this.fpsFrameCount / elapsedMs) * 1000;
        this.fpsFrameCount = 0;
        this.lastFpsCalcTime = now;
      }

      // Save every 100th frame for verification
      if (this.frameCount % 100 === 0) {
        const framePath = path.join(this.framesDir, `frame-${this.frameCount}.jpg`);
        fs.writeFileSync(framePath, frameBuffer);
        this.log('INFO', `Saved 100th frame verification screenshot`, {
          frameCount: this.frameCount,
          path: framePath,
          sizeBytes: frameSize,
          fps: parseFloat(this.currentFps.toFixed(1)),
        });
      }

      // Acknowledge frame immediately so CDP sends the next one
      if (this.cdpSession) {
        await this.cdpSession.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      }

      // Execute callbacks asynchronously (don't block the ack)
      for (const cb of this.callbacks) {
        Promise.resolve(cb(frameBuffer, event.metadata)).catch((cbErr: any) => {
          this.log('WARN', `Error in user frame callback: ${cbErr.message || cbErr}`);
        });
      }
    } catch (error: any) {
      this.log('ERROR', `Error handling incoming frame: ${error.message || error}`);
    }
  }

  /**
   * Get screencast metrics.
   */
  getMetrics() {
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    return {
      totalFrames: this.frameCount,
      elapsedSeconds: parseFloat(elapsedSec.toFixed(2)),
      averageFps: parseFloat((this.frameCount / (elapsedSec || 1)).toFixed(2)),
      currentFps: parseFloat(this.currentFps.toFixed(2)),
      totalMegabytes: parseFloat((this.totalBytes / (1024 * 1024)).toFixed(2)),
      lastTimestamp: this.lastFrameTimestamp,
    };
  }
}
