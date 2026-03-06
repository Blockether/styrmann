export function createLogger(tag: string) {
  const ts = () => new Date().toISOString().slice(11, 19);
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`${ts()} [${tag}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`${ts()} [${tag}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`${ts()} [${tag}] ${msg}`, ...args),
  };
}
