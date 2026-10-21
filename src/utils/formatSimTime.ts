/** HH:MM:SS.mmm of simulated seconds. */
export function formatSimTime(seconds: number) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}
