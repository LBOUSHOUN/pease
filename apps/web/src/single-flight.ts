export function singleFlight<T>(action: () => Promise<T>) {
  let running: Promise<T> | undefined;
  return () => {
    running ??= action().finally(() => {
      running = undefined;
    });
    return running;
  };
}
