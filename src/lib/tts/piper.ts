// Нейросетевой синтез речи Piper прямо в браузере (onnxruntime-web + WASM).
// Модель скачивается один раз с Hugging Face и кешируется в OPFS браузера.
// WASM-движки лежат в public/wasm (их копирует scripts/copy-wasm.mjs).

import { type Clip, decodeToClip } from "@/lib/audio/core";

const WASM_PATHS = {
  onnxWasm: "/wasm/",
  piperData: "/wasm/piper_phonemize.data",
  piperWasm: "/wasm/piper_phonemize.wasm",
};

export type PiperVoice = {
  id: string;
  label: string;
  lang: "ru" | "en";
  gender: "f" | "m";
  sizeMb: number;
};

export const PIPER_VOICES: PiperVoice[] = [
  { id: "ru_RU-irina-medium", label: "Ирина", lang: "ru", gender: "f", sizeMb: 63 },
  { id: "ru_RU-denis-medium", label: "Денис", lang: "ru", gender: "m", sizeMb: 63 },
  { id: "ru_RU-dmitri-medium", label: "Дмитрий", lang: "ru", gender: "m", sizeMb: 63 },
  { id: "ru_RU-ruslan-medium", label: "Руслан", lang: "ru", gender: "m", sizeMb: 63 },
  { id: "en_US-amy-medium", label: "Amy", lang: "en", gender: "f", sizeMb: 63 },
  { id: "en_US-kristin-medium", label: "Kristin", lang: "en", gender: "f", sizeMb: 63 },
  { id: "en_US-hfc_female-medium", label: "HFC Female", lang: "en", gender: "f", sizeMb: 63 },
  { id: "en_US-ryan-medium", label: "Ryan", lang: "en", gender: "m", sizeMb: 63 },
];

type PiperModule = typeof import("@mintplex-labs/piper-tts-web");

let modPromise: Promise<PiperModule> | null = null;
let loadedVoice: string | null = null;

function piper() {
  modPromise ??= import("@mintplex-labs/piper-tts-web");
  return modPromise;
}

export type LoadProgress = { loaded: number; total: number };

export async function storedVoices(): Promise<string[]> {
  try {
    return await (await piper()).stored();
  } catch {
    return [];
  }
}

export async function removeVoice(id: string) {
  const m = await piper();
  await m.remove(id);
  if (loadedVoice === id) {
    m.TtsSession._instance = null;
    loadedVoice = null;
  }
}

export async function speakPiper(
  text: string,
  voiceId: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<Clip> {
  const m = await piper();
  // Библиотека держит единственную сессию и не перезагружает модель при смене голоса.
  if (loadedVoice !== voiceId) m.TtsSession._instance = null;
  try {
    const session = await m.TtsSession.create({
      voiceId,
      progress: (p) => {
        if (!p.url.startsWith("tts://")) onProgress?.({ loaded: p.loaded, total: p.total });
      },
      wasmPaths: WASM_PATHS,
    });
    loadedVoice = voiceId;
    const wav = await session.predict(text);
    return decodeToClip(await wav.arrayBuffer());
  } catch (e) {
    m.TtsSession._instance = null;
    loadedVoice = null;
    throw e;
  }
}
