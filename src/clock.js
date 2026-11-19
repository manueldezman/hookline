export const systemClock = {
  now() {
    return Date.now();
  },
};

export function mutableClock(startMs) {
  let current = startMs;
  return {
    now() {
      return current;
    },
    set(ms) {
      current = ms;
    },
    advance(ms) {
      current += ms;
    },
  };
}
