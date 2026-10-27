"use client";

import { useEffect, useRef, useState } from "react";
import { type Clip, decodeToClip } from "@/lib/audio/core";
import { Button, Notice } from "./ui";

/** Запись с микрофона или загрузка файла → моно-клип. */
export function SourceInput({ onClip }: { onClip: (clip: Clip) => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(t);
  }, [recording]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          onClip(await decodeToClip(await blob.arrayBuffer()));
        } catch {
          setError("Не удалось обработать запись.");
        }
      };
      rec.start();
      recorder.current = rec;
      setElapsed(0);
      setRecording(true);
    } catch {
      setError("Нет доступа к микрофону. Разрешите его в настройках браузера или загрузите файл.");
    }
  };

  const stopRecording = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  const loadFile = async (file: File) => {
    setError(null);
    try {
      onClip(await decodeToClip(await file.arrayBuffer()));
    } catch {
      setError("Этот формат не поддерживается браузером. Попробуйте WAV, MP3 или OGG.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <Button variant="danger" onClick={stopRecording}>
            <span className="size-2.5 animate-pulse rounded-full bg-white" /> Стоп · {elapsed.toFixed(1)} с
          </Button>
        ) : (
          <Button variant="gradient" onClick={startRecording}>🎙 Записать с микрофона</Button>
        )}
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={recording}>
          📁 Загрузить файл
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
