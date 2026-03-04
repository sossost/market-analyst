export function asQuarter(isoDate: string): string {
  const y = isoDate.slice(0, 4);
  const m = Number(isoDate.slice(5, 7));
  return `${y}Q${Math.ceil(m / 3)}`;
}
