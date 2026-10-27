"use client";

import { useState } from "react";
import type { Clip } from "@/lib/audio/core";
import { AudioResult } from "../AudioResult";
import { ChildVoiceControls, useChildVoice } from "../ChildVoiceControls";
import { SourceInput } from "../SourceInput";
import { Card, Notice, SectionTitle } from "../ui";

export function VoiceChangerTab() {
  const [source, setSource] = useState<Clip | null>(null);
  const voice = useChildVoice(source);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Card className="content-start">
        <SectionTitle hint="Запишите свою речь или загрузите аудиофайл — голос станет детским. Всё обрабатывается на вашем устройстве.">
          Исходная запись
        </SectionTitle>
        <SourceInput onClip={setSource} />
        <div className="mt-4">
          {source ? (
            <AudioResult clip={source} label="Оригинал" name="оригинал" compact />
          ) : (
            <Notice>Говорите спокойно и чуть медленнее обычного — так результат звучит естественнее.</Notice>
          )}
        </div>
      </Card>

      <Card className="content-start">
        <ChildVoiceControls voice={voice} />
        {voice.result && (
          <div className="mt-5">
            <AudioResult clip={voice.result} label="Детский голос" name={`изменённый-голос-${voice.presetId || "свой"}`} />
          </div>
        )}
      </Card>
    </div>
  );
}
