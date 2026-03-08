# Logger Debug Mode Support

## Problem

The daemon logger (`src/daemon/logger.ts`) only supports `info`, `warn`, and `error` levels. There's no `debug` level for verbose output during development or troubleshooting.

When investigating issues like the autotrain RESUME signal bug, having debug-level logging would have made the investigation faster.

### Current Behavior

```typescript
export function createLogger(tag: string) {
  return {
    info: (msg, ...args) => console.log(...),
    warn: (msg, ...args) => console.warn(...),
    error: (msg, ...args) => console.error(...),
  };
}
```

### Impact

- No way to enable verbose logging for debugging
- All diagnostic info must use `info` level, which is always on
- Harder to troubleshoot issues in production without flooding logs

## Solution

Add a `debug` method that respects the `MC_DEBUG` environment variable:

```typescript
export function createLogger(tag: string) {
  const isDebugEnabled = () => process.env.MC_DEBUG === 'true';

  return {
    debug: (msg, ...args) => {
      if (isDebugEnabled()) console.log(`${ts()} [${tag}] [DEBUG] ${msg}`, ...args);
    },
    info: (msg, ...args) => console.log(`${ts()} [${tag}] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`${ts()} [${tag}] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`${ts()} [${tag}] ${msg}`, ...args),
  };
}
```

This allows:
- `MC_DEBUG=true` in environment to enable debug logs
- Normal production runs have debug output suppressed
- Consistent with the browser debug utility (`src/lib/debug.ts`)

## Verification

1. Run daemon without MC_DEBUG - no debug logs
2. Run daemon with MC_DEBUG=true - debug logs appear
3. TypeScript compilation passes

## Files Changed

- `src/daemon/logger.ts` - Add debug method with MC_DEBUG support
