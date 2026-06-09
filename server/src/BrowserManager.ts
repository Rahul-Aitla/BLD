import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';

export class BrowserManager extends EventEmitter {
  private cdpUrl: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isConnecting: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private shouldReconnect: boolean = true;
  private onDisconnected: (() => void) | null = null;

  constructor() {
    super();
    this.cdpUrl = process.env.CHROME_CDP_URL || 'http://localhost:9222';
    this.log('INFO', `Initialized BrowserManager with CDP URL: ${this.cdpUrl}`);
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: any) {
    const logObj = {
      timestamp: new Date().toISOString(),
      level,
      component: 'BrowserManager',
      message,
      ...(meta || {}),
    };
    console.log(JSON.stringify(logObj));
  }

  /**
   * Connect to the Chromium instance over CDP.
   * Employs retry logic on initial connection.
   */
  async connect(retries = 5, delayMs = 2000): Promise<void> {
    if (this.browser) {
      this.log('INFO', 'Already connected to Chromium.');
      return;
    }
    if (this.isConnecting) {
      this.log('INFO', 'Connection attempt already in progress.');
      return;
    }
    this.isConnecting = true;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.log('INFO', `Connecting to Chromium over CDP...`, { attempt, maxRetries: retries, url: this.cdpUrl });
        
        // Connect over CDP
        this.browser = await chromium.connectOverCDP(this.cdpUrl);

        // Set up disconnection handler
        this.onDisconnected = () => {
          this.log('WARN', 'Chromium connection disconnected.');
          this.cleanup();
          this.emit('disconnected');
          this.triggerAutoReconnect();
        };
        this.browser.on('disconnected', this.onDisconnected);

        // Initialize and cache context
        const contexts = this.browser.contexts();
        if (contexts.length > 0) {
          this.context = contexts[0];
          this.log('INFO', 'Reusing existing browser context.');
        } else {
          this.context = await this.browser.newContext();
          this.log('INFO', 'Created new browser context.');
        }

        // Initialize and cache page
        const pages = this.context.pages();
        if (pages.length > 0) {
          this.page = pages[0];
          this.log('INFO', 'Reusing existing browser page.');
        } else {
          this.page = await this.context.newPage();
          this.log('INFO', 'Created new browser page.');
        }

          const viewport = this.page.viewportSize();
        this.log('INFO', `Playwright viewport size: ${JSON.stringify(viewport)}`);

      this.log('INFO', 'Successfully connected and initialized browser context/page.');
        this.isConnecting = false;
        this.emit('connected');
        
        // Clear any running reconnection attempts
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
        return;
      } catch (error: any) {
        this.log('ERROR', `Connection attempt ${attempt} failed: ${error.message || error}`);
        this.cleanup();
        
        if (attempt === retries) {
          this.isConnecting = false;
          throw new Error(`Failed to connect to Chromium after ${retries} attempts.`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Disconnect cleanly from the browser.
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.log('INFO', 'Disconnecting BrowserManager cleanly...');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error: any) {
        this.log('WARN', `Error while closing browser on disconnect: ${error.message || error}`);
      }
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.browser && this.onDisconnected) {
      this.browser.removeListener('disconnected', this.onDisconnected);
    }
    this.onDisconnected = null;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private triggerAutoReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimeout) return;
    this.log('INFO', 'Initiating background auto-reconnection loop.');
    
    const tryReconnect = async () => {
      try {
        await this.connect(1, 0);
      } catch (err: any) {
        this.log('WARN', 'Auto-reconnect attempt failed. Retrying in 2000ms...');
        this.reconnectTimeout = setTimeout(tryReconnect, 2000);
      }
    };
    
    this.reconnectTimeout = setTimeout(tryReconnect, 2000);
  }

  private async ensureConnected(): Promise<Page> {
    if (!this.browser || !this.page) {
      this.log('WARN', 'Browser not connected. Attempting connection now...');
      await this.connect(3, 1000);
    }
    if (!this.page) {
      throw new Error('Browser page is not available. Connection failed.');
    }
    return this.page;
  }

  /**
   * Navigate to the specified URL.
   */
  async navigate(url: string): Promise<void> {
    const page = await this.ensureConnected();
    this.log('INFO', `Navigating page to URL: ${url}`);
    await page.goto(url, { waitUntil: 'load' });
  }

  /**
   * Take a screenshot of the page and save it to the specified path.
   */
  async screenshot(path: string): Promise<Buffer> {
    const page = await this.ensureConnected();
    this.log('INFO', `Taking page screenshot to path: ${path}`);
    return await page.screenshot({ path });
  }

  /**
   * Click at the specified coordinates (x, y).
   */
  async click(x: number, y: number): Promise<void> {
    const page = await this.ensureConnected();
    this.log('INFO', `Clicking at coordinates: (${x}, ${y})`);
    await page.mouse.click(x, y);
  }

  /**
   * Type the specified text.
   */
  async type(text: string): Promise<void> {
    const page = await this.ensureConnected();
    this.log('INFO', `Typing text: "${text}"`);
    await page.keyboard.type(text);
  }

  /**
   * Scroll vertically by deltaY.
   */
  async scroll(deltaY: number): Promise<void> {
    const page = await this.ensureConnected();
    this.log('INFO', `Scrolling with deltaY: ${deltaY}`);
    await page.mouse.wheel(0, deltaY);
  }

  /**
   * Gets the current page title. Helper for testing.
   */
  async getTitle(): Promise<string> {
    const page = await this.ensureConnected();
    return await page.title();
  }

  /**
   * Expose the cached Playwright Page instance.
   */
  getPage(): Page | null {
    return this.page;
  }
}
