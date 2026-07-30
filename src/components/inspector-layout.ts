export const INSPECTOR_HEIGHT_KEY = "bestgres:inspector-height";
export const INSPECTOR_DEFAULT_HEIGHT = 192;
export const INSPECTOR_MIN_HEIGHT = 120;
export const INSPECTOR_RESIZE_STEP = 32;
const MIN_GRID_HEIGHT = 180;

export function maxInspectorHeight(viewportHeight: number): number {
  return Math.max(INSPECTOR_MIN_HEIGHT, viewportHeight - MIN_GRID_HEIGHT);
}

export function clampInspectorHeight(height: number, viewportHeight: number): number {
  return Math.min(
    Math.max(Math.round(height), INSPECTOR_MIN_HEIGHT),
    maxInspectorHeight(viewportHeight)
  );
}

export function resizedInspectorHeight(
  startHeight: number,
  startY: number,
  currentY: number,
  viewportHeight: number
): number {
  return clampInspectorHeight(startHeight + startY - currentY, viewportHeight);
}

export function readInspectorHeight(
  storage: Pick<Storage, "getItem">,
  viewportHeight: number
): number {
  const saved = Number(storage.getItem(INSPECTOR_HEIGHT_KEY));
  if (!Number.isFinite(saved) || saved <= 0) return INSPECTOR_DEFAULT_HEIGHT;
  return clampInspectorHeight(saved, viewportHeight);
}
