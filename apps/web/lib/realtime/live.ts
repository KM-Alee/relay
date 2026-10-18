// "Live screen" registry: screens that need 1 s polling (Lead Radar, a visible countdown) acquire it;
// the poller uses the fast interval while at least one is held. Framework-free; see useRealtimeLive().
let held = 0;

export function acquireLive(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = Math.max(0, held - 1);
  };
}

export function isLive(): boolean {
  return held > 0;
}
