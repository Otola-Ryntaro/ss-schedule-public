// where: scripts/generate-icons.mjs
// what: SS-008 用の仮 PWA アイコン PNG（192/512 の any + maskable 計 4 枚）を生成する
// why: Lighthouse Installable 基準を満たす最小サイズの単色 PNG を、追加依存なし（Node 標準の zlib のみ）で出力する。
//      仮アイコンなので sharp / ImageMagick 等は導入しない（YAGNI）。後日デザインができたら差し替える前提。
//
// 使い方: `bun run scripts/generate-icons.mjs` または `node scripts/generate-icons.mjs`

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ブランドカラー（manifest.json の theme_color と揃える）
const BRAND = { r: 0x0f, g: 0x17, b: 0x2a }; // #0f172a (slate-900)
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

/**
 * 単色背景の中央に小さめの白い正方形（"アイコンらしさ"を最低限つけるため）を描画する関数。
 * maskable 用には safe-area（中央 80%）に収まるように小さめに描く。
 */
function buildPixelGrid(size, { maskable }) {
  // RGBA pixel buffer。各行先頭に PNG filter byte (0) を入れる。
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);

  // 背景塗り
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = BRAND.r;
      raw[px + 1] = BRAND.g;
      raw[px + 2] = BRAND.b;
      raw[px + 3] = 0xff;
    }
  }

  // 中央に白い正方形（"S" の代わりの最小プレースホルダ）
  // maskable は safe-area 80% に収めるので、より小さく
  const innerRatio = maskable ? 0.32 : 0.42;
  const inner = Math.round(size * innerRatio);
  const offset = Math.round((size - inner) / 2);
  for (let y = offset; y < offset + inner; y++) {
    const rowStart = y * stride;
    for (let x = offset; x < offset + inner; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = WHITE.r;
      raw[px + 1] = WHITE.g;
      raw[px + 2] = WHITE.b;
      raw[px + 3] = 0xff;
    }
  }

  return raw;
}

/**
 * PNG chunk を組み立てる: length(4) + type(4) + data(n) + crc32(type+data)(4)
 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, raw) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  // IHDR: width(4) height(4) bitdepth(1) colortype(1=RGBA->6) compression(0) filter(0) interlace(0)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ]);
}

function writeIcon(filename, size, { maskable }) {
  const raw = buildPixelGrid(size, { maskable });
  const png = encodePng(size, raw);
  const outPath = join(__dirname, "..", "public", "icons", filename);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

writeIcon("icon-192.png", 192, { maskable: false });
writeIcon("icon-512.png", 512, { maskable: false });
writeIcon("icon-maskable-192.png", 192, { maskable: true });
writeIcon("icon-maskable-512.png", 512, { maskable: true });
