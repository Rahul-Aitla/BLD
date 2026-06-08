import { BrowserManager } from './BrowserManager';
import { ScreencastManager } from './ScreencastManager';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('--- PHASE 3: CDP SCREENCAST FPS TEST ---');
  console.log('Goal: Measure FPS of Page.startScreencast with continuous animation');
  console.log('Duration: 30 seconds\n');

  const browserManager = new BrowserManager();
  const screencastManager = new ScreencastManager(browserManager);

  const frameTimestamps: number[] = [];

  try {
    await browserManager.connect();

    const htmlPath = path.join(__dirname, '..', 'test-animation.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const page = browserManager.getPage()!;

    await page.setContent(html);
    console.log('[Test] Animation page loaded.\n');

    await new Promise(r => setTimeout(r, 1000));

    await screencastManager.start();

    screencastManager.onFrame((_frameBuffer, _metadata) => {
      frameTimestamps.push(Date.now());
    });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const elapsed = i + 1;
      const currentFrames = frameTimestamps.length;
      const fps = elapsed > 0 ? (currentFrames / elapsed).toFixed(1) : '0';
      process.stdout.write(`\r[Test] ${elapsed}s elapsed | ${currentFrames} frames received | avg FPS: ${fps}`);
    }
    process.stdout.write('\n\n');

    await screencastManager.stop();
    await browserManager.disconnect();

    const durationSec = 30;
    const totalFrames = frameTimestamps.length;
    const averageFps = totalFrames / durationSec;

    const perSecondFps: number[] = [];
    if (frameTimestamps.length > 0) {
      const startTime = frameTimestamps[0];
      let bucketEnd = startTime + 1000;
      let count = 0;
      for (const ts of frameTimestamps) {
        if (ts < bucketEnd) {
          count++;
        } else {
          perSecondFps.push(count);
          while (ts >= bucketEnd + 1000) bucketEnd += 1000;
          bucketEnd += 1000;
          count = 1;
        }
      }
      if (count > 0) perSecondFps.push(count);
    }

    const maxFps = perSecondFps.length > 0 ? Math.max(...perSecondFps) : 0;
    const minFps = perSecondFps.length > 0 ? Math.min(...perSecondFps) : 0;
    const totalMissing = perSecondFps.filter(f => f === 0).length;

    console.log('========================================');
    console.log('  CDP SCREENCAST FPS RESULTS');
    console.log('========================================');
    console.log(`  Duration:         ${durationSec}s`);
    console.log(`  Total frames:     ${totalFrames}`);
    console.log(`  Average FPS:      ${averageFps.toFixed(2)}`);
    console.log(`  Maximum FPS:      ${maxFps}`);
    console.log(`  Minimum FPS:      ${minFps}`);
    console.log(`  Zero-frame secs:  ${totalMissing}`);
    console.log(`  Per-second FPS:   ${perSecondFps.join(', ')}`);

    console.log('\n========================================');
    console.log('  CONCLUSION');
    console.log('========================================');
    if (totalFrames > 0 && minFps > 0) {
      console.log('  Page.startScreencast PRODUCES continuous');
      console.log('  frames when the page continuously repaints.');
      console.log(`  Frames arrived every second (min ${minFps} FPS).`);
    } else if (totalFrames > 0 && minFps === 0) {
      console.log('  Page.startScreencast mostly produces frames,');
      console.log('  but some seconds had zero frames (gaps exist).');
    } else {
      console.log('  Page.startScreencast did NOT produce frames.');
    }
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.error('\n[Test] Fatal error:', error);
    try { await screencastManager.stop(); } catch (_) {}
    try { await browserManager.disconnect(); } catch (_) {}
    process.exit(1);
  }
}

main();
