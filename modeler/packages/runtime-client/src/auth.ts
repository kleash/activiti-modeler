/** A request as the transport has built it, before it is sent. An {@link Auth} may change the headers and the credentials mode. */
export interface PreparedRequest {
  readonly method: string;
  readonly url: string;
  headers: Record<string, string>;
  /** The fetch `credentials` mode; the default is `same-origin`. */
  credentials?: 'omit' | 'same-origin' | 'include';
}

/** How the client authenticates. The server decides what it accepts; the client only adds what the scheme needs. */
export interface Auth {
  prepare(request: PreparedRequest): void | Promise<void>;
}

/** No credentials: for public endpoints (`/health`), or when the browser or a proxy adds them. */
export const noAuth: Auth = { prepare() {} };

/** HTTP Basic: the modeler server's demo users. The credentials are UTF-8 encoded as RFC 7617 asks. */
export function basicAuth(username: string, password: string): Auth {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const value = `Basic ${btoa(binary)}`;
  return {
    prepare(request) {
      request.headers['Authorization'] = value;
    },
  };
}

/** A bearer token (OAuth2 / JWT). Give a function when the token changes: it is called for every request. */
export function bearerAuth(token: string | (() => string | Promise<string>)): Auth {
  return {
    async prepare(request) {
      const value = typeof token === 'function' ? await token() : token;
      request.headers['Authorization'] = `Bearer ${value}`;
    },
  };
}

export interface CookieAuthOptions {
  /** Name of the cookie that holds the CSRF token; Spring Security's default is `XSRF-TOKEN`. */
  csrfCookie?: string;
  /** Header the token is sent in; Spring Security's default is `X-XSRF-TOKEN`. */
  csrfHeader?: string;
  /** `same-origin` (default) when the app is served by the host that hosts the API, `include` for another origin. */
  credentials?: 'same-origin' | 'include';
  /** Reads a cookie; the default reads `document.cookie`. */
  readCookie?: (name: string) => string | undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session cookie of the host application, for a UI embedded in a host app: the browser sends the session cookie, and for
 * every request that changes something the CSRF token (from its cookie) goes into the CSRF header, as Spring Security's
 * `CookieCsrfTokenRepository` expects.
 */
export function cookieAuth(options: CookieAuthOptions = {}): Auth {
  const cookieName = options.csrfCookie ?? 'XSRF-TOKEN';
  const headerName = options.csrfHeader ?? 'X-XSRF-TOKEN';
  const read = options.readCookie ?? readDocumentCookie;
  return {
    prepare(request) {
      request.credentials = options.credentials ?? 'same-origin';
      if (!SAFE_METHODS.has(request.method)) {
        const token = read(cookieName);
        if (token) {
          request.headers[headerName] = token;
        }
      }
    },
  };
}

function readDocumentCookie(name: string): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}
