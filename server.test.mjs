import { describe, expect, it, vi } from "vitest";
import { buildSessionRecord, createSupabaseRepository, deleteWorldRecord, saveSessionRecord } from "./server.mjs";

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

  it("Supabase repository는 저장된 세계를 삭제한다", async () => {
    const query = {
      delete: vi.fn(() => query),
      eq: vi.fn(() => query),
    };
    const supabase = {
      from: vi.fn(() => query),
    };
    const repository = createSupabaseRepository(supabase);

    const result = await repository.deleteWorld("world-1");

    expect(result).toEqual({ ok: true, worldId: "world-1" });
    expect(supabase.from).toHaveBeenCalledWith("worlds");
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("id", "world-1");
  });

  it("deleteWorldRecord는 빈 world id를 거절한다", async () => {
    await expect(deleteWorldRecord("")).rejects.toThrow("삭제할 세계 ID가 없습니다.");
  });
});

describe("비공개 이야기 작업실 저장소", () => {
  const draft = {
    id: "draft-1",
    worldId: "world-1",
    sessionId: "session-1",
    title: "금지된 지도",
    body: "잠수사는 금지된 지도를 펼쳤다.",
    status: "proposed",
    sourceTranscriptIds: ["line-1", "line-2"],
    relatedCanonIds: ["canon-1"],
    createdAt: "2026-07-31T00:00:00.000Z",
  };

  function createQuery(result = { data: [], error: null }) {
    const query = {
      insert: vi.fn(() => query),
      update: vi.fn(() => query),
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      single: vi.fn(() => query),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  }

  it("새 초안을 해당 세계와 출처 참조에 연결해 저장한다", async () => {
    const query = createQuery();
    const supabase = { from: vi.fn(() => query) };
    const repository = createSupabaseRepository(supabase);

    await repository.insertStoryDraft(draft);

    expect(supabase.from).toHaveBeenCalledWith("story_drafts");
    expect(query.insert).toHaveBeenCalledWith({
      id: "draft-1",
      world_id: "world-1",
      session_id: "session-1",
      title: "금지된 지도",
      body: "잠수사는 금지된 지도를 펼쳤다.",
      status: "proposed",
      source_transcript_ids: ["line-1", "line-2"],
      related_canon_ids: ["canon-1"],
      parent_draft_id: null,
      created_at: "2026-07-31T00:00:00.000Z",
    });
  });

  it("수정은 부모를 revising으로 바꾸고 출처를 보존한 새 버전을 만든다", async () => {
    const parentQuery = createQuery({ data: { id: "draft-1", world_id: "world-1", session_id: "session-1", source_transcript_ids: ["line-1", "line-2"], related_canon_ids: ["canon-1"] }, error: null });
    const parentUpdateQuery = createQuery();
    const revisionQuery = createQuery();
    const supabase = { from: vi.fn().mockReturnValueOnce(parentQuery).mockReturnValueOnce(parentUpdateQuery).mockReturnValueOnce(revisionQuery) };
    const repository = createSupabaseRepository(supabase);

    await repository.reviseStoryDraft("world-1", "draft-1", {
      id: "draft-2",
      title: "항구의 지도",
      body: "항구에서 지도가 펼쳐졌다.",
      createdAt: "2026-07-31T01:00:00.000Z",
    });

    expect(parentQuery.eq).toHaveBeenCalledWith("world_id", "world-1");
    expect(parentQuery.eq).toHaveBeenCalledWith("id", "draft-1");
    expect(parentUpdateQuery.update).toHaveBeenCalledWith({ status: "revising" });
    expect(parentUpdateQuery.eq).toHaveBeenCalledWith("id", "draft-1");
    expect(revisionQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: "draft-2",
      world_id: "world-1",
      parent_draft_id: "draft-1",
      source_transcript_ids: ["line-1", "line-2"],
      related_canon_ids: ["canon-1"],
    }));
  });

  it("채택은 원자적 RPC로 장면과 초안 상태를 함께 저장한다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [{ id: "scene-draft-1", world_id: "world-1", draft_id: "draft-1", title: draft.title, content: draft.body, sequence: 4, accepted_at: "2026-07-31T02:00:00.000Z", source_transcript_ids: ["line-1", "line-2"], related_canon_ids: ["canon-1"] }], error: null })) };
    const repository = createSupabaseRepository(supabase);

    const scene = await repository.acceptStoryDraft("world-1", "draft-1", "2026-07-31T02:00:00.000Z");

    expect(scene).toMatchObject({ worldId: "world-1", draftId: "draft-1", order: 4 });
    expect(supabase.rpc).toHaveBeenCalledWith("accept_story_draft", {
      p_world_id: "world-1", p_draft_id: "draft-1", p_scene_id: "scene-draft-1", p_accepted_at: "2026-07-31T02:00:00.000Z",
    });
  });

  it("채택 RPC가 허용되지 않은 상태를 거절하면 장면을 반환하지 않는다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: "채택할 수 없는 초안입니다." } })) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.acceptStoryDraft("world-1", "draft-1")).rejects.toThrow("채택할 수 없는 초안입니다.");
  });

  it("채택 RPC가 충돌 또는 실패하면 오류를 그대로 전달한다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } })) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.acceptStoryDraft("world-1", "draft-1")).rejects.toThrow("duplicate key");
  });
  it("원고 조회는 해당 세계의 채택된 장면만 순서대로 반환한다", async () => {
    const query = createQuery({
      data: [
        { id: "scene-1", world_id: "world-1", draft_id: "draft-1", content: "첫 장면", sequence: 1, accepted_at: "2026-07-31T02:00:00.000Z", source_transcript_ids: ["line-1"], related_canon_ids: ["canon-1"] },
      ],
      error: null,
    });
    const supabase = { from: vi.fn(() => query) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.listWorldManuscript("world-1")).resolves.toEqual([
      expect.objectContaining({ worldId: "world-1", order: 1, sourceTranscriptIds: ["line-1"] }),
    ]);
    expect(supabase.from).toHaveBeenCalledWith("story_scenes");
    expect(query.eq).toHaveBeenCalledWith("world_id", "world-1");
    expect(query.eq).toHaveBeenCalledWith("status", "accepted");
    expect(query.order).toHaveBeenCalledWith("sequence", { ascending: true });
  });
});
