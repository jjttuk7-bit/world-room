export type Speaker = "사용자" | "동반자" | "시스템";

export type TranscriptLine = {
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
};

export type RealtimeSignal =
  | { kind: "transcript"; speaker: Speaker; text: string; final: boolean }
  | { kind: "status"; status: "listening" | "speaking" | "ready" | "recovering"; message: string }
  | { kind: "error"; message: string }
  | { kind: "spark"; text: string };

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  text?: string;
  error?: { message?: string };
  item?: {
    role?: string;
    content?: Array<{ transcript?: string; text?: string }>;
  };
  response?: {
    output?: Array<{
      content?: Array<{ transcript?: string; text?: string }>;
    }>;
  };
};

export function reduceRealtimeEvent(event: RealtimeEvent): RealtimeSignal[] {
  const type = event.type ?? "";

  if (type === "error") {
    return [{ kind: "error", message: event.error?.message ?? "Realtime 세션에서 알 수 없는 오류가 발생했습니다." }];
  }

  if (type === "input_audio_buffer.speech_started") {
    return [{ kind: "status", status: "listening", message: "사용자 음성을 듣는 중" }];
  }

  if (type === "input_audio_buffer.speech_stopped") {
    return [{ kind: "status", status: "recovering", message: "생각을 정리하는 중" }];
  }

  if (type === "response.audio.started" || type === "response.created") {
    return [{ kind: "status", status: "speaking", message: "동반자가 말하는 중" }];
  }

  if (type === "response.done") {
    return [{ kind: "status", status: "ready", message: "다음 장면을 기다리는 중" }];
  }

  if (type.includes("input_audio_transcription") && (event.transcript || event.delta)) {
    return [
      {
        kind: "transcript",
        speaker: "사용자",
        text: event.transcript ?? event.delta ?? "",
        final: type.endsWith(".completed"),
      },
    ];
  }

  if ((type.includes("response.audio_transcript") || type.includes("response.output_audio_transcript")) && (event.transcript || event.delta)) {
    const text = event.transcript ?? event.delta ?? "";
    return [
      {
        kind: "transcript",
        speaker: "동반자",
        text,
        final: type.endsWith(".done") || type.endsWith(".completed"),
      },
      ...extractSparks(text),
    ];
  }

  const completedText =
    event.response?.output?.flatMap((output) => output.content ?? []).find((content) => content.transcript || content.text)
      ?.transcript ??
    event.response?.output?.flatMap((output) => output.content ?? []).find((content) => content.transcript || content.text)?.text ??
    event.item?.content?.find((content) => content.transcript || content.text)?.transcript ??
    event.item?.content?.find((content) => content.transcript || content.text)?.text ??
    event.text;

  if (completedText && (type === "conversation.item.input_audio_transcription.completed" || type === "response.done")) {
    return [
      {
        kind: "transcript",
        speaker: type.startsWith("conversation") ? "사용자" : "동반자",
        text: completedText,
        final: true,
      },
      ...extractSparks(completedText),
    ];
  }

  return [];
}

export function appendTranscriptLine(lines: TranscriptLine[], signal: Extract<RealtimeSignal, { kind: "transcript" }>) {
  const last = lines[lines.length - 1];

  if (last && last.speaker === signal.speaker && !last.final) {
    return [
      ...lines.slice(0, -1),
      {
        ...last,
        text: signal.final ? signal.text : `${last.text}${signal.text}`,
        final: signal.final,
      },
    ];
  }

  return [
    ...lines,
    {
      id: `${Date.now()}-${lines.length}`,
      speaker: signal.speaker,
      text: signal.text,
      final: signal.final,
    },
  ];
}

export function extractSparks(text: string): RealtimeSignal[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^(설정|인물|갈등|장면|훅)\s*[:：]/.test(line))
    .slice(0, 4)
    .map((line) => ({ kind: "spark", text: line }));
}
