import { BrowserManager } from './BrowserManager';
import { ScreencastManager } from './ScreencastManager';

async function main() {
  console.log('--- STARTING PHASE 3 SCREENCAST TEST (30 SECONDS) ---');
  const browserManager = new BrowserManager();
  const screencastManager = new ScreencastManager(browserManager);

  try {
    // 1. Connect BrowserManager
    await browserManager.connect();

    // 2. Start Screencast
    await screencastManager.start();

    // 3. Register a basic callback to show frames are arriving
    let localFrameCount = 0;
    screencastManager.onFrame((frameBuffer, metadata) => {
      localFrameCount++;
      // Log simple verification message every 50 frames to avoid spamming
      if (localFrameCount % 50 === 0) {
        console.log(`[Test Script] Received frame count: ${localFrameCount} (Size: ${frameBuffer.length} bytes)`);
      }
    });

    // 4. Print rolling stats every 3 seconds
    const statsInterval = setInterval(() => {
      const metrics = screencastManager.getMetrics();
      console.log(`[Screencast Stats] Time: ${metrics.elapsedSeconds}s | Total Frames: ${metrics.totalFrames} | Avg FPS: ${metrics.averageFps} | Current FPS: ${metrics.currentFps} | Size: ${metrics.totalMegabytes} MB`);
    }, 3000);

    // 5. Simulate browser activity over 30 seconds to trigger renders
    console.log('[Test Script] Navigating to Hacker News...');
    await browserManager.navigate('https://news.ycombinator.com');
    await new Promise((resolve) => setTimeout(resolve, 8000));

    console.log('[Test Script] Scrolling page down...');
    await browserManager.scroll(400);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('[Test Script] Scrolling page further down...');
    await browserManager.scroll(600);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('[Test Script] Navigating to Example.com...');
    await browserManager.navigate('https://example.com');
    await new Promise((resolve) => setTimeout(resolve, 6000));

    console.log('[Test Script] Scrolling page on Example...');
    await browserManager.scroll(200);
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // 6. Clean up
    clearInterval(statsInterval);
    await screencastManager.stop();

    // Print final metrics
    const finalMetrics = screencastManager.getMetrics();
    console.log('\n--- FINAL SCREENCAST STATISTICS ---');
    console.log(`Elapsed Time:    ${finalMetrics.elapsedSeconds} seconds`);
    console.log(`Total Frames:    ${finalMetrics.totalFrames} frames`);
    console.log(`Average FPS:     ${finalMetrics.averageFps} fps`);
    console.log(`Total Data:      ${finalMetrics.totalMegabytes} MB`);
    console.log('------------------------------------');

    await browserManager.disconnect();
    console.log('--- TEST COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (error) {
    console.error('[Test Script] Fatal error during screencast run:', error);
    await screencastManager.stop();
    await browserManager.disconnect();
    process.exit(1);
  }
}

main();
