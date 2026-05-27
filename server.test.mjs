import { describe, expect, it, vi } from "vitest";
import { buildSessionRecord, createSupabaseRepository, saveSessionRecord } from "./server.mjs";

describe("World Room 세션 저장", () => {
  it("transcript와 sparks를 Supabase 저장 record로 정리한다", async () => {
    const repository = {
      saveSession: vi.fn(async (record) => ({ ok: true, path: `supabase/worlds/${record.world.id}` })),
    };

    const result = await saveSessionRecord(
      {
        title: "나는 도시",
        transcript: [
          { id: "1", speaker: "사용자", text: "나는 도시", final: true },
          { id: "2", speaker: "동반자", text: "설정: 비가 거꾸로 오는 도시", final: true },
        ],
        sparks: ["설정: 비가 거꾸로 오는 도시"],
      },
      {
        repository,
        model: "gpt-realtime-2",
        voice: "marin",
        now: new Date("2026-05-27T18:33:21+09:00"),
        summarize: async () => ({
          title: "나는 도시",
          summary: "비가 거꾸로 오는 도시를 만들었다.",
          canonUpdates: {
            settings: ["비가 거꾸로 온다."],
            characters: [],
            conflicts: [],
            sceneHooks: [],
          },
          nextQuestions: ["도시는 왜 비를 거슬러 올리나요?"],
          continuityBrief: "비가 거꾸로 오는 도시에서 이어간다.",
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      path: "supabase/worlds/world-20260527-183321",
    });
    expect(repository.saveSession).toHaveBeenCalledWith({
      world: expect.objectContaining({
        id: "world-20260527-183321",
        title: "나는 도시",
        summary: "비가 거꾸로 오는 도시를 만들었다.",
        continuityBrief: "비가 거꾸로 오는 도시에서 이어간다.",
      }),
      session: expect.objectContaining({
        id: "20260527-183321-world-room",
        worldId: "world-20260527-183321",
        title: "나는 도시",
        summary: "비가 거꾸로 오는 도시를 만들었다.",
        nextQuestions: ["도시는 왜 비를 거슬러 올리나요?"],
      }),
      canonCards: [
        expect.objectContaining({
          type: "setting",
          title: "비가 거꾸로 온다.",
          content: "비가 거꾸로 온다.",
        }),
      ],
    });
    expect(JSON.stringify(repository.saveSession.mock.calls)).not.toContain("sk-");
    expect(JSON.stringify(repository.saveSession.mock.calls)).not.toContain("client_secret");
  });

  it("저장할 사용자/동반자 transcript가 없으면 거절한다", () => {
    expect(() =>
      buildSessionRecord(
        {
          title: "빈 세션",
          transcript: [{ id: "welcome", speaker: "시스템", text: "환영", final: true }],
          sparks: [],
        },
        {
          model: "gpt-realtime-2",
          voice: "marin",
          now: new Date("2026-05-27T18:33:21+09:00"),
        },
      ),
    ).toThrow("저장할 대화 기록이 없습니다.");
  });

  it("Supabase repository는 worlds, sessions, canon_cards를 저장한다", async () => {
    const calls = [];
    const query = {
      upsert: vi.fn((value) => {
        calls.push(["upsert", value]);
        return query;
      }),
      insert: vi.fn((value) => {
        calls.push(["insert", value]);
        return query;
      }),
      update: vi.fn((value) => {
        calls.push(["update", value]);
        return query;
      }),
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      limit: vi.fn(() => query),
      order: vi.fn(() => query),
    };
    const supabase = {
      from: vi.fn(() => query),
    };
    const repository = createSupabaseRepository(supabase);

    await repository.saveSession({
      world: { id: "world-1", title: "세계", summary: "요약", continuityBrief: "기억", latestSessionId: "session-1" },
      session: { id: "session-1", worldId: "world-1", title: "세션", transcript: [], sparks: [], summary: "요약", nextQuestions: [] },
      canonCards: [{ id: "card-1", worldId: "world-1", type: "setting", title: "설정", content: "설정", sourceSessionId: "session-1" }],
    });

    expect(supabase.from).toHaveBeenCalledWith("worlds");
    expect(supabase.from).toHaveBeenCalledWith("sessions");
    expect(supabase.from).toHaveBeenCalledWith("canon_cards");
    expect(calls).toEqual(
      expect.arrayContaining([
        ["upsert", expect.objectContaining({ id: "world-1", continuity_brief: "기억" })],
        ["upsert", expect.objectContaining({ id: "session-1", world_id: "world-1" })],
        ["insert", [expect.objectContaining({ id: "card-1", world_id: "world-1", type: "setting" })]],
        ["update", expect.objectContaining({ latest_session_id: "session-1" })],
      ]),
    );
  });
});
