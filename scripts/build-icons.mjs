import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "assets", "branding");
const iconDir = path.join(root, "src-tauri", "icons");
const publicDir = path.join(root, "public");
const generatedDir = path.join(sourceDir, "generated");
const largeSource = path.join(sourceDir, "castaryn-icon-large.png");
const smallSource = path.join(sourceDir, "castaryn-icon-small.png");

await mkdir(iconDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });

async function render(source, size, output) {
  await sharp(source)
    .resize(size, size, {
      fit: "cover",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: size <= 48 ? 0.65 : 0.35 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
}

const windowsPngs = [
  ["32x32.png", 32, smallSource],
  ["64x64.png", 64, smallSource],
  ["128x128.png", 128, largeSource],
  ["128x128@2x.png", 256, largeSource],
  ["icon.png", 512, largeSource],
  ["StoreLogo.png", 50, smallSource],
  ["Square30x30Logo.png", 30, smallSource],
  ["Square44x44Logo.png", 44, smallSource],
  ["Square71x71Logo.png", 71, smallSource],
  ["Square89x89Logo.png", 89, smallSource],
  ["Square107x107Logo.png", 107, smallSource],
  ["Square142x142Logo.png", 142, largeSource],
  ["Square150x150Logo.png", 150, largeSource],
  ["Square284x284Logo.png", 284, largeSource],
  ["Square310x310Logo.png", 310, largeSource],
];

await Promise.all(
  windowsPngs.map(([name, size, source]) =>
    render(source, size, path.join(iconDir, name)),
  ),
);

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icoFiles = [];

for (const size of icoSizes) {
  const output = path.join(generatedDir, `castaryn-${size}.png`);
  await render(size <= 64 ? smallSource : largeSource, size, output);
  icoFiles.push(output);
}

const ico = await pngToIco(icoFiles);
await writeFile(path.join(iconDir, "icon.ico"), ico);

await copyFile(smallSource, path.join(publicDir, "castaryn-icon.png"));

console.log(
  `Castaryn icons built: ${icoSizes.join(", ")} px Windows ICO plus application tiles.`,
);
