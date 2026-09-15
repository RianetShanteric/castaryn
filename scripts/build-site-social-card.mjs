import sharp from "sharp";
import { fileURLToPath } from "node:url";

const width = 1200;
const height = 630;
const source = fileURLToPath(new URL(
  "../assets/branding/castaryn-icon-large.png",
  import.meta.url,
));
const destination = fileURLToPath(new URL(
  "../apps/site/public/castaryn-social.png",
  import.meta.url,
));

const background = Buffer.from(`
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="78%" cy="12%" r="72%">
        <stop offset="0" stop-color="#173c35"/>
        <stop offset="0.54" stop-color="#0b1617"/>
        <stop offset="1" stop-color="#080c0f"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    <path d="M0 96H1200M0 192H1200M0 288H1200M0 384H1200M0 480H1200M0 576H1200" stroke="#91a19f" stroke-opacity=".055"/>
    <rect x="56" y="56" width="1088" height="518" rx="28" fill="none" stroke="#91a19f" stroke-opacity=".18"/>
    <text x="92" y="182" fill="#66dec4" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="1">PERFECT WORLD · WINDOWS</text>
    <text x="92" y="294" fill="#f2f6f5" font-family="Arial, sans-serif" font-size="82" font-weight="700" letter-spacing="-3">Castaryn</text>
    <text x="92" y="370" fill="#bdc8c6" font-family="Arial, sans-serif" font-size="34">PvE-трекер и калькулятор фарма</text>
    <text x="92" y="438" fill="#91a19f" font-family="Arial, sans-serif" font-size="25">Локальные данные · Twitch · YouTube · OBS</text>
  </svg>
`);

const icon = await sharp(source)
  .resize(300, 300, { fit: "contain" })
  .png()
  .toBuffer();

await sharp(background)
  .composite([{ input: icon, left: 820, top: 165 }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(destination);

console.log(`Created ${destination}`);
