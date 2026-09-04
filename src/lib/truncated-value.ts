/**
 * Placeholder for a cell whose value was cut off server-side because it is
 * larger than the table browser's per-cell preview cap. The grid shows the
 * preview; the inspector fetches the full value by primary key on demand.
 */
export class TruncatedValue {
  constructor(public readonly preview: string) {}
}

export function isTruncated(value: unknown): value is TruncatedValue {
  return value instanceof TruncatedValue;
}
