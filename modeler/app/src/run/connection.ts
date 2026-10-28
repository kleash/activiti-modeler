/**
 * The connection to a modeler server (feature R1): where it is, who we are, and what it reports (Activiti version, DMN engine,
 * whether the async executor runs). One service for the page, like the lint service; React reads it through `useConnection`.
 *
 * Credentials: HTTP Basic against the server's demo users. The URL and the user name are remembered in `localStorage`; the
 * password is kept in memory only (gone when the page is closed or reloaded), unless the person ticks "remember the password in
 * this browser", which stores it in `localStorage` as plain text (the modeler server is a localhost development tool).
 */
import { basicAuth, noAuth, RuntimeApiError, RuntimeClient, RuntimeNetworkError, type EngineInfo, type Health } from '@activiti-modeler/runtime-client';

export const CONNECTION_STORAGE_KEY = 'activiti-modeler.connection';

export interface ConnectionSettings {
  /** Origin of the server. Empty: the server that served this page (the bundled app). */
  baseUrl: string;
  username: string;
  /** Keep the password in `localStorage` (opt-in). */
  rememberPassword: boolean;
}

export type ConnectionStatus =
  /** Not checked yet. */
  | 'unknown'
  /** Nothing answers at the URL. */
  | 'unreachable'
  /** The server is there but there are no (valid) credentials. */
  | 'signed-out'
  | 'connected';

export interface ConnectionSnapshot {
  settings: ConnectionSettings;
  status: ConnectionStatus;
  /** Why the last attempt failed. */
  error?: string;
  engine?: EngineInfo;
  health?: Health;
  /** The signed-in user (when connected). */
  user?: string;
  busy: boolean;
  revision: number;
}

interface StoredSettings extends Partial<ConnectionSettings> {
  password?: string;
}

/** Response header of the modeler server (`WebConfiguration.SERVER_HEADER`). */
const SERVER_HEADER = 'x-activiti-modeler-server';

export const DEFAULT_SETTINGS: ConnectionSettings = { baseUrl: '', username: 'modeler', rememberPassword: false };

/** The page served by `vite dev` / `vite preview` has no server of its own: the modeler server is then expected on its default port. */
export function defaultBaseUrl(pageOrigin: { port: string } | undefined = typeof location === 'undefined' ? undefined : location): string {
  return pageOrigin && (pageOrigin.port === '5173' || pageOrigin.port === '4173') ? 'http://localhost:8080' : '';
}

/**
 * Was this page served by the modeler server? The server marks every response with `X-Activiti-Modeler-Server`; the page asks for
 * itself (a request that succeeds on any host) and looks for the header.
 */
export async function pageIsServedByModelerServer(): Promise<boolean> {
  if (typeof location === 'undefined' || typeof fetch === 'undefined') return false;
  try {
    const response = await fetch(location.pathname || '/', { method: 'HEAD', cache: 'no-store' });
    return response.headers.has(SERVER_HEADER);
  } catch {
    return false;
  }
}

const HEALTH_INTERVAL_MS = 10_000;

const describe = (error: unknown): string => {
  if (error instanceof RuntimeApiError) return error.status === 401 ? 'The server does not accept this user name and password (401).' : error.message;
  if (error instanceof RuntimeNetworkError) return `No answer from the server: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export class ConnectionService {
  private readonly listeners = new Set<() => void>();
  private settings: ConnectionSettings = { ...DEFAULT_SETTINGS, baseUrl: defaultBaseUrl() };
  private password = '';
  private status: ConnectionStatus = 'unknown';
  private error: string | undefined;
  private engine: EngineInfo | undefined;
  private health: Health | undefined;
  private user: string | undefined;
  private busy = false;
  private revision = 0;
  private client: RuntimeClient | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Settings were stored by an earlier session: the user has used a server before. */
  private hadStoredSettings = false;
  /** A probe has been made (on load or by the user); only then is an unreachable server looked for again. */
  private watching = false;
  private snap: ConnectionSnapshot;

  constructor(
    private readonly storage: StorageLike | undefined = browserStorage(),
    private readonly fetchImpl?: typeof fetch,
    private readonly pageHasServer: () => Promise<boolean> = pageIsServedByModelerServer,
  ) {
    this.load();
    this.snap = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConnectionSnapshot => this.snap;

  private build(): ConnectionSnapshot {
    return {
      settings: this.settings,
      status: this.status,
      ...(this.error ? { error: this.error } : {}),
      ...(this.engine ? { engine: this.engine } : {}),
      ...(this.health ? { health: this.health } : {}),
      ...(this.user ? { user: this.user } : {}),
      busy: this.busy,
      revision: this.revision,
    };
  }

  private emit(): void {
    this.revision += 1;
    this.snap = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  // --- persistence ----------------------------------------------------------------------------------------------------------------

  private load(): void {
    try {
      const raw = this.storage?.getItem(CONNECTION_STORAGE_KEY);
      if (!raw) return;
      this.hadStoredSettings = true;
      const stored = JSON.parse(raw) as StoredSettings;
      this.settings = {
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : defaultBaseUrl(),
        username: typeof stored.username === 'string' && stored.username ? stored.username : DEFAULT_SETTINGS.username,
        rememberPassword: stored.rememberPassword === true,
      };
      if (this.settings.rememberPassword && typeof stored.password === 'string') this.password = stored.password;
    } catch {
      // unreadable settings are the defaults
    }
  }

  private save(): void {
    try {
      const stored: StoredSettings = { ...this.settings, ...(this.settings.rememberPassword ? { password: this.password } : {}) };
      this.storage?.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // storage is a convenience
    }
  }

  // --- access ------------------------------------------------------------------------------------------------------------------------

  /** The client of the current settings; use `require()` for an operation that needs the connection. */
  private makeClient(settings: ConnectionSettings, password: string): RuntimeClient {
    return new RuntimeClient({
      baseUrl: settings.baseUrl,
      auth: settings.username ? basicAuth(settings.username, password) : noAuth,
      ...(this.fetchImpl ? { fetch: (input, init) => this.fetchImpl!(input, init) } : {}),
    });
  }

  get connected(): boolean {
    return this.status === 'connected';
  }

  /** The client when connected; otherwise an error that tells the person what to do. */
  require(): RuntimeClient {
    if (!this.client || this.status !== 'connected') throw new Error('Not connected to a modeler server. Use Run > Connect to server.');
    return this.client;
  }

  /** `Authorization` header for requests the app makes itself (the server workspace). */
  authHeaders(): Record<string, string> {
    if (!this.settings.username || this.status !== 'connected') return {};
    const bytes = new TextEncoder().encode(`${this.settings.username}:${this.password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { Authorization: `Basic ${btoa(binary)}` };
  }

  /** The workspace endpoint of the server. */
  workspaceUrl(): string {
    return `${this.settings.baseUrl.replace(/\/+$/, '')}/api/dev/workspace`;
  }

  // --- life cycle ------------------------------------------------------------------------------------------------------------------

  /** Looks for the server (health needs no credentials) and signs in when a password is remembered or was typed earlier. */
  async init(): Promise<void> {
    // A failed request is logged by the browser as a console error whatever the page does with it. A page that was not served by the
    // modeler server (vite dev / preview, the static e2e config) and a user who never connected one do not ask for /api/health: the
    // status stays "not connected" until the user opens the connection dialog.
    if (this.hadStoredSettings || (await this.pageHasServer())) {
      await this.probe();
      if (this.status === 'signed-out' && this.password) await this.signIn();
    }
    this.startMonitor();
  }

  /** Is a modeler server at the URL? Sets `unreachable` or `signed-out` (or keeps `connected`). */
  async probe(): Promise<void> {
    this.watching = true;
    // /api/health is public: asked without credentials (the server answers 401 to wrong credentials even on a public path)
    const client = this.makeClient({ ...this.settings, username: '' }, '');
    try {
      this.health = await client.getHealth();
      if (this.status !== 'connected') {
        this.status = 'signed-out';
        this.error = undefined;
      }
    } catch (error) {
      this.health = undefined;
      this.client = undefined;
      this.engine = undefined;
      this.user = undefined;
      // an answer that is an HTTP error means somebody is there; a refused connection or a page that is not the server means nobody is
      this.status = 'unreachable';
      this.error = error instanceof RuntimeApiError ? `${displayUrl(this.settings.baseUrl)} answered ${error.status} to /api/health: that is not a modeler server` : error instanceof SyntaxError ? `${displayUrl(this.settings.baseUrl)} does not serve the modeler server API` : describe(error);
    }
    this.emit();
  }

  private async signIn(): Promise<boolean> {
    const client = this.makeClient(this.settings, this.password);
    this.busy = true;
    this.emit();
    try {
      this.engine = await client.getEngine();
      this.client = client;
      this.user = this.settings.username;
      this.status = 'connected';
      this.error = undefined;
      return true;
    } catch (error) {
      this.client = undefined;
      this.engine = undefined;
      this.user = undefined;
      this.status = error instanceof RuntimeNetworkError ? 'unreachable' : 'signed-out';
      this.error = describe(error);
      return false;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Signs in with these settings. Resolves true when the server accepted them; the settings are remembered then. */
  async connect(settings: ConnectionSettings, password: string): Promise<boolean> {
    this.settings = { ...settings, baseUrl: settings.baseUrl.trim().replace(/\/+$/, '') };
    this.password = password;
    const ok = await this.signIn();
    if (ok) this.save();
    else if (this.status === 'signed-out') this.save();
    this.startMonitor();
    return ok;
  }

  disconnect(): void {
    this.client = undefined;
    this.engine = undefined;
    this.user = undefined;
    this.password = '';
    this.status = 'signed-out';
    this.error = undefined;
    // forget a remembered password too: disconnecting means signing out
    if (this.settings.rememberPassword) {
      this.settings = { ...this.settings, rememberPassword: false };
      this.save();
    }
    this.emit();
  }

  /** Re-reads the engine report (the executor may have been switched, the server restarted). */
  async refreshEngine(): Promise<void> {
    if (!this.client) return;
    try {
      this.engine = await this.client.getEngine();
      this.emit();
    } catch (error) {
      await this.onFailure(error);
    }
  }

  private async onFailure(error: unknown): Promise<void> {
    if (error instanceof RuntimeNetworkError) {
      this.status = 'unreachable';
      this.error = describe(error);
      this.client = undefined;
      this.engine = undefined;
      this.user = undefined;
      this.emit();
    } else if (error instanceof RuntimeApiError && error.status === 401) {
      this.status = 'signed-out';
      this.error = describe(error);
      this.client = undefined;
      this.user = undefined;
      this.emit();
    }
  }

  private startMonitor(): void {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => {
      if (this.busy) return;
      if (this.status === 'connected') void this.refreshEngine();
      else if (this.status === 'unreachable' && this.watching) void this.probe();
    }, HEALTH_INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** A short text for the status bar. */
  summary(): string {
    const s = this.snap;
    if (s.status === 'connected' && s.engine) {
      const dmn = s.engine.dmn.available ? `DMN ${s.engine.dmn.engine ?? 'on'}` : 'no DMN';
      return `Server: ${s.user}@${displayUrl(s.settings.baseUrl)} - Activiti ${s.engine.activitiVersion} - ${dmn} - executor ${s.engine.asyncExecutor.active ? 'on' : 'off'}`;
    }
    if (s.status === 'signed-out') return `Server: ${displayUrl(s.settings.baseUrl)} found, not signed in`;
    // nothing answers (or nobody asked yet): the details are in the tooltip
    return 'Server: not connected';
  }
}

export function displayUrl(baseUrl: string): string {
  if (baseUrl) return baseUrl.replace(/^https?:\/\//, '');
  return typeof location === 'undefined' ? 'this server' : location.host || 'this server';
}

/** The connection of the page. */
export const connection = new ConnectionService();
