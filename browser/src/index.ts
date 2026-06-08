import express from 'express';
import { chromium } from 'playwright';
import { spawn, ChildProcess } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;
let browserProcess: ChildProcess | null = null;
let socatProcess: ChildProcess | null = null;

async function launchBrowser() {
  try {
    const executablePath = chromium.executablePath();
    console.log(`Chromium executable path: ${executablePath}`);
    console.log('Spawning Chromium process on port 9223...');
    browserProcess = spawn(
      executablePath,
      [
        '--headless=new',
        '--window-size=1280,720',
        '--remote-debugging-port=9223',
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      {
        stdio: 'ignore',
        detached: true,
      }
    );

    browserProcess.on('error', (err) => {
      console.error('Chromium process error:', err);
    });

    browserProcess.on('exit', (code, signal) => {
      console.log(`Chromium process exited with code ${code} and signal ${signal}`);
    });

    // Wait for Chromium to start
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log('Chromium process spawned.');

    console.log('Spawning socat to proxy port 9222 to 127.0.0.1:9223...');
    socatProcess = spawn(
      'socat',
      [
        'TCP-LISTEN:9222,fork,reuseaddr',
        'TCP:127.0.0.1:9223'
      ],
      {
        stdio: 'ignore',
        detached: true,
      }
    );

    socatProcess.on('error', (err) => {
      console.error('socat process error:', err);
    });

    socatProcess.on('exit', (code, signal) => {
      console.log(`socat process exited with code ${code} and signal ${signal}`);
    });

    // Wait a short moment for socat to bind
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('socat process spawned successfully.');
  } catch (error) {
    console.error('Failed to launch browser services:', error);
    process.exit(1);
  }
}

app.get('/health', async (req, res) => {
  try {
    // Attempt to query the remote debugging port to confirm Chromium is responsive
    const response = await fetch('http://127.0.0.1:9223/json/version');
    if (response.ok) {
      const data = await response.json();
      res.status(200).json({
        status: 'ok',
        chromium: 'running',
        info: data,
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: `Chromium debug port returned status ${response.status}`,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: `Failed to connect to Chromium debug port: ${error.message || error}`,
    });
  }
});

// Fallback index route
app.get('/', (req, res) => {
  res.send('Browser service is running. Use /health for health check.');
});

// Start the server and launch the browser
const server = app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await launchBrowser();
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutdown signal received. Closing browser and server...');
  if (socatProcess) {
    try {
      console.log('Killing socat process...');
      socatProcess.kill('SIGKILL');
    } catch (err) {
      console.error('Error killing socat process:', err);
    }
  }
  if (browserProcess) {
    try {
      console.log('Killing Chromium process...');
      browserProcess.kill('SIGKILL');
      console.log('Chromium process killed.');
    } catch (err) {
      console.error('Error killing Chromium process:', err);
    }
  }
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
