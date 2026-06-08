import { BrowserManager } from './BrowserManager';
import * as path from 'path';

async function main() {
  console.log('--- STARTING PHASE 2 BROWSERMANAGER TEST ---');
  const manager = new BrowserManager();

  try {
    // 1. Connect to Chromium
    await manager.connect();

    // 2. Navigate to https://example.com
    await manager.navigate('https://example.com');

    // 3. Print the page title
    const title = await manager.getTitle();
    console.log(`[Test Script] Page Title extracted: "${title}"`);

    // 4. Take a screenshot
    const screenshotPath = path.join(__dirname, '..', 'screenshot.png');
    await manager.screenshot(screenshotPath);
    console.log(`[Test Script] Screenshot successfully saved to: ${screenshotPath}`);

    // 5. Clean exit
    await manager.disconnect();
    console.log('--- TEST COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (error) {
    console.error('[Test Script] Fatal error occurred during execution:', error);
    await manager.disconnect();
    process.exit(1);
  }
}

main();
