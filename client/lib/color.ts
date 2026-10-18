/**
 * Category colours are tuned for marks (wedges, lines, dots). Some are too light for small text, so text in
 * a category colour, and filled controls carrying white text, use a darker shade of the same hue.
 */
const PAGE_BG = [0xf6, 0xf3, 0xec]; // --bg, the darkest surface such text sits on
const shades = new Map<string, string>();

function luminance(rgb: number[]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
}

/** `hex` (#rrggbb), darkened just enough for small text on the app's light surfaces (and white text on it) to reach 4.5:1. */
export function textShade(hex: string): string {
  const known = shades.get(hex);
  if (known) return known;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const bg = luminance(PAGE_BG) + 0.05;
  let k = 1;
  let shaded = rgb;
  while (k > 0.2 && bg / (luminance(shaded) + 0.05) < 4.5) {
    k -= 0.02;
    shaded = rgb.map((c) => Math.round(c * k));
  }
  const shade = `#${shaded.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  shades.set(hex, shade);
  return shade;
}
