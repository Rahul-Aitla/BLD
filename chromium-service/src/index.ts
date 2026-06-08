import express from 'express';
import { chromium } from 'playwright';
import { spawn, ChildProcess } from 'child_process';

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
let browserProcess: ChildProcess | null = null;
let socatProcess: ChildProcess | null = null;

type BrowserState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
let browserState: BrowserState = 'stopped';

function killProcess(proc: ChildProcess | null, name: string) {
  if (proc) {
    try {
      proc.kill('SIGKILL');
      console.log(`${name} killed.`);
    } catch (err) {
      console.error(`Error killing ${name}:`, err);
    }
  }
}

async function launchBrowser() {
  if (browserState === 'running') return;
  browserState = 'starting';
  try {
    const executablePath = chromium.executablePath();
    console.log(`Chromium executable path: ${executablePath}`);
    console.log('Spawning Chromium process on port 9223...');
    browserProcess = spawn(
      executablePath,
      [
        '--headless=new',
        '--window-size=1920,1080',
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
      browserState = 'error';
    });

    browserProcess.on('exit', (code, signal) => {
      console.log(`Chromium process exited with code ${code} and signal ${signal}`);
      if (browserState !== 'stopping') {
        browserState = 'stopped';
      }
    });

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

    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('socat process spawned successfully.');
    browserState = 'running';
  } catch (error) {
    console.error('Failed to launch browser services:', error);
    browserState = 'error';
    throw error;
  }
}

async function stopBrowser() {
  if (browserState === 'stopped') return;
  browserState = 'stopping';
  killProcess(socatProcess, 'socat process');
  socatProcess = null;
  killProcess(browserProcess, 'Chromium process');
  browserProcess = null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  browserState = 'stopped';
}

app.get('/health', async (req, res) => {
  try {
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

app.get('/', (req, res) => {
  res.send('Browser service is running. Use /health for health check.');
});

app.post('/start', async (req, res) => {
  try {
    await launchBrowser();
    res.json({ status: 'ok', state: browserState });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message, state: browserState });
  }
});

app.post('/stop', async (req, res) => {
  try {
    await stopBrowser();
    res.json({ status: 'ok', state: browserState });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message, state: browserState });
  }
});

app.post('/restart', async (req, res) => {
  try {
    await stopBrowser();
    await launchBrowser();
    res.json({ status: 'ok', state: browserState });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message, state: browserState });
  }
});

app.get('/status', (req, res) => {
  res.json({
    state: browserState,
    chromium: browserProcess !== null,
    socat: socatProcess !== null,
  });
});

const server = app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await launchBrowser();
});

const shutdown = async () => {
  console.log('Shutdown signal received. Closing browser and server...');
  await stopBrowser();
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
