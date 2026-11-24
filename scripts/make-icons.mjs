// Renders the asterisk app icons (PWA, Apple touch icon) from SVG.  node scripts/make-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const spokes = (c, r, w, color) => {
  const d = r * Math.SQRT1_2;
  return `<g stroke="${color}" stroke-width="${w}" stroke-linecap="round">
    <line x1="${c}" y1="${c - r}" x2="${c}" y2="${c + r}"/><line x1="${c - r}" y1="${c}" x2="${c + r}" y2="${c}"/>
    <line x1="${c - d}" y1="${c - d}" x2="${c + d}" y2="${c + d}"/><line x1="${c + d}" y1="${c - d}" x2="${c - d}" y2="${c + d}"/></g>`;
};
// regular: asterisk fills ~64% of a cream tile; maskable: inside the 80% safe zone
const svg = (size, scale, rounded) => {
  const c = size / 2, r = (size * scale) / 2, w = r * 0.3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#f9f1e8"/>${spokes(c, r, w, "#ffa927")}</svg>`;
};
const out = [
  ["public/icons/icon-192.png", 192, 0.62, true],
  ["public/icons/icon-512.png", 512, 0.62, true],
  ["public/icons/maskable-512.png", 512, 0.46, false],
  ["public/icons/apple-touch-icon.png", 180, 0.56, false],
];
for (const [file, size, scale, rounded] of out) {
  await sharp(Buffer.from(svg(size, scale, rounded))).png().toFile(file);
  console.log("wrote", file);
}
// Android status-bar badge: white asterisk on transparent
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${spokes(48, 38, 12, "#ffffff")}</svg>`)).png().toFile("public/icons/badge-96.png");
console.log("wrote public/icons/badge-96.png");
writeFileSync("public/icons/asterisk.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${spokes(50, 41, 13, "#ffa927")}</svg>\n`);
