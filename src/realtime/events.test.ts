import { describe, expect, it, vi } from "vitest";
import { appendTranscriptLine, extractSparks, reduceRealtimeEvent } from "./events";

describe("Realtime 이벤트 정리", () => {
  it("사용자 음성 전사 완료 이벤트를 한국어 transcript 신호로 바꾼다", () => {
    const signals = reduceRealtimeEvent({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "안개 도시에서 시작하고 싶어.",
    });

    expect(signals).toEqual([
      {
        kind: "transcript",
        speaker: "사용자",
        text: "안개 도시에서 시작하고 싶어.",
        final: true,
      },
    ]);
  });

  it("동반자 transcript 델타에서 세계 만들기 단서를 뽑는다", () => {
    const signals = reduceRealtimeEvent({
      type: "response.audio_transcript.delta",
      delta: "설정: 바다 위를 걷는 도서관\n갈등: 책장이 조수처럼 밀려옵니다.",
    });

    expect(signals).toContainEqual({
      kind: "spark",
      text: "설정: 바다 위를 걷는 도서관",
    });
    expect(signals).toContainEqual({
      kind: "spark",
      text: "갈등: 책장이 조수처럼 밀려옵니다.",
    });
  });

  it("진행 중인 transcript 델타를 마지막 줄에 이어 붙이고 완료되면 고정한다", () => {
    vi.setSystemTime(new Date("2026-05-27T00:00:00.000Z"));
    const first = appendTranscriptLine([], {
      kind: "transcript",
      speaker: "동반자",
      text: "좋아요,",
      final: false,
    });
    const second = appendTranscriptLine(first, {
      kind: "transcript",
      speaker: "동반자",
      text: " 문을 열어봅시다.",
      final: true,
    });

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      speaker: "동반자",
      text: " 문을 열어봅시다.",
      final: true,
    });
  });
});

describe("세계 만들기 단서 추출", () => {
  it("정해진 라벨이 붙은 줄만 단서로 사용한다", () => {
    expect(extractSparks("잡담\n인물: 유리 지도를 읽는 소년\n장면: 폭풍 속 정거장")).toEqual([
      { kind: "spark", text: "인물: 유리 지도를 읽는 소년" },
      { kind: "spark", text: "장면: 폭풍 속 정거장" },
    ]);
  });
});

describe("output-audio transcript", () => {
  it("records OpenAI output-audio transcript events as companion speech", () => {
    expect(reduceRealtimeEvent({
      type: "response.output_audio_transcript.done",
      transcript: "설정: 항구의 시계는 바닷물을 거슬러 갑니다.",
    })).toContainEqual(expect.objectContaining({ speaker: "동반자", final: true }));
  });
});