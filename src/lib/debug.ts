/**
 * Debug Logging Utility
 * Enable with localStorage.setItem('STYRMAN_DEBUG', 'true')
 * Or run mcDebug.enable() in browser console
 */

const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return true; // Always log server-side
  return localStorage.getItem('STYRMAN_DEBUG') === 'true';
};

export const debug = {
  sse: (message: string, data?: unknown) => {
    if (isDebugEnabled()) {
      console.log(`[SSE] ${message}`, data !== undefined ? data : '');
    }
  },
  store: (message: string, data?: unknown) => {
    if (isDebugEnabled()) {
      console.log(`[STORE] ${message}`, data !== undefined ? data : '');
    }
  },
  api: (message: string, data?: unknown) => {
    if (isDebugEnabled()) {
      console.log(`[API] ${message}`, data !== undefined ? data : '');
    }
  },
  config: (message: string, data?: unknown) => {
    if (isDebugEnabled()) {
      console.log(`[CONFIG] ${message}`, data !== undefined ? data : '');
    }
  },
  file: (message: string, data?: unknown) => {
    if (isDebugEnabled()) {
      console.log(`[FILE] ${message}`, data !== undefined ? data : '');
    }
  }
};

// Enable debug mode helper
export const enableDebug = () => {
  if (typeof window !== 'undefined') {
  localStorage.setItem('STYRMAN_DEBUG', 'true');
    console.log('[DEBUG] Debug mode enabled. Refresh to see all logs.');
  }
};

export const disableDebug = () => {
  if (typeof window !== 'undefined') {
  localStorage.removeItem('STYRMAN_DEBUG');
    console.log('[DEBUG] Debug mode disabled.');
  }
};

// Expose to window for easy access in browser console
if (typeof window !== 'undefined') {
  (window as unknown as { mcDebug: { enable: () => void; disable: () => void } }).mcDebug = {
    enable: enableDebug,
    disable: disableDebug
  };
}
