/**
 * Verifies the WCAG 2.1 contrast ratios of the design tokens declared in
 * `src/index.css` (Requirement 14.4): text pairs >= 4.5:1, borders and focus
 * ring against their background >= 3:1.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';

// Vitest blanks CSS imports (even `?raw`), so the stylesheet is read from disk.
// Vitest runs from the `web/` workspace directory.
const indexCss = readFileSync('src/index.css', 'utf8');

function readTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1] as string] = (match[2] as string).toLowerCase();
  }
  return tokens;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const tokens = readTokens(indexCss);

/** [foreground token, background token] pairs rendered as text (>= 4.5:1). */
const TEXT_PAIRS: Array<[string, string]> = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text', 'color-surface-sunken'],
  ['color-text', 'color-primary-soft'],
  ['color-text', 'color-success-bg'],
  ['color-text', 'color-danger-bg'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-surface'],
  ['color-text-muted', 'color-surface-sunken'],
  ['color-on-primary', 'color-primary'],
  ['color-on-primary', 'color-primary-hover'],
  ['color-primary', 'color-bg'],
  ['color-primary', 'color-primary-soft'],
  ['color-success', 'color-success-bg'],
  ['color-danger', 'color-danger-bg'],
  ['color-disabled-text', 'color-disabled-bg'],
];

/** [component token, background token] pairs for borders and focus ring (>= 3:1). */
const NON_TEXT_PAIRS: Array<[string, string]> = [
  ['color-border-strong', 'color-bg'],
  ['color-disabled-border', 'color-disabled-bg'],
  ['color-primary', 'color-bg'],
  ['color-success-border', 'color-success-bg'],
  ['color-danger-border', 'color-danger-bg'],
  ['color-focus', 'color-bg'],
  ['color-focus', 'color-surface'],
  ['color-focus', 'color-surface-sunken'],
  ['color-focus', 'color-danger-bg'],
];

function ratio(pair: [string, string]): number {
  const [fg, bg] = pair;
  const fgHex = tokens[fg];
  const bgHex = tokens[bg];
  if (fgHex === undefined || bgHex === undefined) {
    throw new Error(`Missing token in index.css: ${fg} or ${bg}`);
  }
  return contrast(fgHex, bgHex);
}

describe('design tokens contrast', () => {
  it.each(TEXT_PAIRS)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio([fg, bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('component %s against %s is at least 3:1', (fg, bg) => {
    expect(ratio([fg, bg])).toBeGreaterThanOrEqual(3);
  });
});
