import * as wrtc from '@roamhq/wrtc';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserManager } from './BrowserManager';
import { ScreencastManager } from './ScreencastManager';
import { VideoSourceManager } from './VideoSourceManager';

const { RTCPeerConnection, RTCSessionDescription } = wrtc;
const { RTCVideoSink } = wrtc.nonstandard;

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== PHASE 4: CDP SCREENCAST \u2192 WebRTC VIDEO PIPELINE ===\n');

  const browserManager = new BrowserManager();
  const screencastManager = new ScreencastManager(browserManager);
  const videoSource = new VideoSourceManager();

  let receivedFrames = 0;
  let pipelineFrames = 0;
  let webrtcConnected = false;
  let sink: any = null;

  try {
    await browserManager.connect();

    const htmlPath = path.join(__dirname, '..', 'test-animation.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const dataUri = 'data:text/html;base64,' + Buffer.from(html).toString('base64');
    const page = browserManager.getPage()!;
    await page.goto(dataUri);
    console.log('[Test] Animation page loaded via data URI.\n');

    // WebRTC loopback
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();

    pc1.addTrack(videoSource.getTrack());

    pc2.ontrack = (event: any) => {
      console.log('[WebRTC] Receiver got track:', event.track.kind);
      sink = new RTCVideoSink(event.track);
      sink.onframe = () => { receivedFrames++; };
    };

    pc1.oniceconnectionstatechange = () => {
      if (pc1.iceConnectionState === 'connected' && !webrtcConnected) {
        webrtcConnected = true;
        console.log('[WebRTC] ICE connected');
      }
    };

    pc1.onicecandidate = async (event: any) => {
      if (event.candidate) {
        await pc2.addIceCandidate(event.candidate).catch(() => {});
      }
    };
    pc2.onicecandidate = async (event: any) => {
      if (event.candidate) {
        await pc1.addIceCandidate(event.candidate).catch(() => {});
      }
    };

    const offer = await pc1.createOffer({ offerToReceiveVideo: false });
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(new RTCSessionDescription(answer));

    console.log('[WebRTC] Offer/answer exchanged\n');

    // Start screencast + feed frames into WebRTC
    screencastManager.onFrame(async (frameBuffer: Buffer, _metadata: any) => {
      await videoSource.feedFrame(frameBuffer);
      pipelineFrames++;
    });

    await screencastManager.start();

    // Monitor for 10 seconds
    for (let i = 0; i < 10; i++) {
      await delay(1000);
      const sourceFps = videoSource.getFrameCount();
      const metrics = screencastManager.getMetrics();
      process.stdout.write(
        `\r[${i + 1}s] WebRTC: ${webrtcConnected ? 'CONNECTED' : 'connecting...'} | ` +
        `Source: ${sourceFps} | Pipeline: ${pipelineFrames} | ` +
        `Received: ${receivedFrames} | CDP avg FPS: ${metrics.averageFps}`
      );
    }
    process.stdout.write('\n\n');

    await screencastManager.stop();
    await browserManager.disconnect();

    // Final stats
    const metrics = screencastManager.getMetrics();
    console.log('========================================');
    console.log('  PIPELINE RESULTS');
    console.log('========================================');
    console.log('  WebRTC connection:          ', webrtcConnected ? 'CONNECTED' : 'FAILED');
    console.log('  Screencast frames:          ', metrics.totalFrames);
    console.log('  Frames pushed to source:    ', videoSource.getFrameCount());
    console.log('  Frames through pipeline:    ', pipelineFrames);
    console.log('  Frames received by sink:    ', receivedFrames);
    console.log('  Screencast avg FPS:         ', metrics.averageFps);

    const success = webrtcConnected && receivedFrames > 0;
    console.log('\n========================================');
    console.log('  CONCLUSION');
    console.log('========================================');
    if (success) {
      console.log('  CDP screencast frames successfully');
      console.log('  converted and streamed over WebRTC.');
      console.log('  JPEG \u2192 RGBA \u2192 I420 \u2192 RTCVideoSource pipeline works.');
    } else {
      console.log('  Pipeline did not complete successfully.');
      console.log(`  (connected=${webrtcConnected}, received=${receivedFrames})`);
    }
    console.log('========================================');

    if (sink) sink.stop();
    videoSource.stop();
    pc1.close();
    pc2.close();

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n[Test] Fatal error:', error);
    try { await screencastManager.stop(); } catch (_) {}
    try { await browserManager.disconnect(); } catch (_) {}
    if (sink) sink.stop();
    videoSource.stop();
    process.exit(1);
  }
}

main();
