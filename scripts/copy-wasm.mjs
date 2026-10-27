// Копирует WASM-движки синтеза речи в public/wasm, чтобы не зависеть от CDN.
// Запускается автоматически после npm install и перед dev/build.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "wasm");
mkdirSync(out, { recursive: true });

const files = [
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data",
  "node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm",
];

for (const rel of files) {
  const src = join(root, rel);
  const dst = join(out, rel.split("/").pop());
  if (!existsSync(src)) {
    console.warn(`[copy-wasm] не найден ${rel}`);
    continue;
  }
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
  copyFileSync(src, dst);
  console.log(`[copy-wasm] ${rel} → public/wasm`);
}
