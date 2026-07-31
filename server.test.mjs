import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildSessionRecord, createSupabaseRepository, deleteWorldRecord, generateStoryDraft, getWorldStory, holdSavedStoryDraft, listWorldDrafts, saveSessionRecord, validateStoryDraftRequest } from "./server.mjs";

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
        ["upsert", expect.objectContaining({ id: "world-1", owner_id: "00000000-0000-0000-0000-000000000001", continuity_brief: "기억" })],
        ["upsert", expect.objectContaining({ id: "session-1", world_id: "world-1", owner_id: "00000000-0000-0000-0000-000000000001" })],
        ["insert", [expect.objectContaining({ id: "card-1", world_id: "world-1", owner_id: "00000000-0000-0000-0000-000000000001", type: "setting" })]],
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

    await repository.insertStoryDraft(draft, { worldChecked: true });

    expect(supabase.from).toHaveBeenCalledWith("story_drafts");
    expect(query.insert).toHaveBeenCalledWith({
      id: "draft-1",
      world_id: "world-1",
      owner_id: "00000000-0000-0000-0000-000000000001",
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

  it("수정은 원자적 RPC로 부모 잠금과 수정본 생성을 함께 요청한다", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: [{
          id: "draft-2", world_id: "world-1", session_id: "session-1", title: "항구의 지도",
          body: "항구에서 지도가 펼쳐졌다.", status: "proposed", source_transcript_ids: ["line-1", "line-2"],
          related_canon_ids: ["canon-1"], parent_draft_id: "draft-1", created_at: "2026-07-31T01:00:00.000Z",
        }],
        error: null,
      })),
    };
    const repository = createSupabaseRepository(supabase);

    const created = await repository.reviseStoryDraft("world-1", "draft-1", {
      id: "draft-2",
      title: "항구의 지도",
      body: "항구에서 지도가 펼쳐졌다.",
      createdAt: "2026-07-31T01:00:00.000Z",
    }, { worldChecked: true });

    expect(created).toMatchObject({ id: "draft-2", worldId: "world-1", parentDraftId: "draft-1", sourceTranscriptIds: ["line-1", "line-2"] });
    expect(supabase.rpc).toHaveBeenCalledWith("revise_story_draft", {
      p_world_id: "world-1", p_parent_draft_id: "draft-1", p_revision_id: "draft-2",
      p_title: "항구의 지도", p_body: "항구에서 지도가 펼쳐졌다.", p_owner_id: "00000000-0000-0000-0000-000000000001", p_created_at: "2026-07-31T01:00:00.000Z",
    });
  });

  it("수정 RPC가 같은 부모의 중복 수정본을 거절하면 오류를 전달한다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: "이미 진행 중인 수정본이 있습니다." } })) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.reviseStoryDraft("world-1", "draft-1", { id: "draft-2", title: "수정", body: "본문" }, { worldChecked: true }))
      .rejects.toThrow("이미 진행 중인 수정본이 있습니다.");
  });

  it("채택은 원자적 RPC로 장면과 초안 상태를 함께 저장한다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [{ id: "scene-draft-1", world_id: "world-1", draft_id: "draft-1", title: draft.title, content: draft.body, sequence: 4, accepted_at: "2026-07-31T02:00:00.000Z", source_transcript_ids: ["line-1", "line-2"], related_canon_ids: ["canon-1"] }], error: null })) };
    const repository = createSupabaseRepository(supabase);

    const scene = await repository.acceptStoryDraft("world-1", "draft-1", "2026-07-31T02:00:00.000Z", { worldChecked: true });

    expect(scene).toMatchObject({ worldId: "world-1", draftId: "draft-1", order: 4 });
    expect(supabase.rpc).toHaveBeenCalledWith("accept_story_draft", {
      p_world_id: "world-1", p_draft_id: "draft-1", p_scene_id: "scene-draft-1", p_owner_id: "00000000-0000-0000-0000-000000000001", p_accepted_at: "2026-07-31T02:00:00.000Z",
    });
  });

  it("채택 RPC가 허용되지 않은 상태를 거절하면 장면을 반환하지 않는다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: "채택할 수 없는 초안입니다." } })) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.acceptStoryDraft("world-1", "draft-1", undefined, { worldChecked: true })).rejects.toThrow("채택할 수 없는 초안입니다.");
  });

  it("채택 RPC가 충돌 또는 실패하면 오류를 그대로 전달한다", async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } })) };
    const repository = createSupabaseRepository(supabase);

    await expect(repository.acceptStoryDraft("world-1", "draft-1", undefined, { worldChecked: true })).rejects.toThrow("duplicate key");
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

    await expect(repository.listWorldManuscript("world-1", { worldChecked: true })).resolves.toEqual([
      expect.objectContaining({ worldId: "world-1", order: 1, sourceTranscriptIds: ["line-1"] }),
    ]);
    expect(supabase.from).toHaveBeenCalledWith("story_scenes");
    expect(query.eq).toHaveBeenCalledWith("world_id", "world-1");
    expect(query.eq).toHaveBeenCalledWith("owner_id", "00000000-0000-0000-0000-000000000001");
    expect(query.eq).toHaveBeenCalledWith("status", "accepted");
    expect(query.order).toHaveBeenCalledWith("sequence", { ascending: true });
  });
});

describe("비공개 이야기 작업실 스키마", () => {
  it("수정과 채택 RPC를 서비스 역할 전용의 트랜잭션 함수로 제한한다", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");

    expect(schema).toContain("create or replace function public.revise_story_draft(");
    expect(schema).toMatch(/create or replace function public\.revise_story_draft\([\s\S]*?security definer/);
    expect(schema).toMatch(/alter table public\.story_drafts enable row level security/);
    expect(schema).toMatch(/revoke all on function public\.revise_story_draft[\s\S]*?from public, anon, authenticated/);
    expect(schema).toMatch(/revoke all on function public\.accept_story_draft[\s\S]*?from public, anon, authenticated/);
  });
});

describe("장면 초안 생성", () => {
  const request = {
    worldId: "world-1",
    sessionId: "session-1",
    world: { title: "역류항", continuityBrief: "비가 하늘로 솟는 항구 도시다." },
    transcript: [
      { id: "line-1", speaker: "사용자", text: "잠수사가 금지된 지도를 찾게 하자." },
      { id: "line-2", speaker: "동반자", text: "그 지도는 수면 위로 가는 길을 가리킵니다." },
    ],
    canon: [{ id: "canon-1", type: "setting", content: "비는 바다에서 하늘로 오른다." }],
  };

  it("허용된 대화와 세계 성경 범위를 벗어난 요청을 거절한다", () => {
    expect(() => validateStoryDraftRequest({ ...request, transcript: Array.from({ length: 17 }, (_, index) => ({ id: `${index}`, text: "대화" })) }))
      .toThrow("대화 맥락은 최대 16개까지 사용할 수 있습니다.");
    expect(() => validateStoryDraftRequest({ ...request, world: { continuityBrief: "가".repeat(3001) } }))
      .toThrow("세계 설명은 3000자 이하여야 합니다.");
  });

  it("Responses API의 구조화된 초안을 원본 근거에만 연결한다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ title: "금지된 지도", body: "잠수사는 방파제 아래에서 젖지 않는 지도를 발견했다. 지도 위의 선은 하늘을 향해 흐르는 빗줄기를 따라 항구 밖으로 이어졌다. 그는 수면 위에 남아 있을지도 모를 기억을 떠올렸다.", sourceTranscriptIds: ["line-1"], relatedCanonIds: ["canon-1"] }) }),
    }));
    await expect(generateStoryDraft(request, { apiKey: "test-key", fetchImpl })).resolves.toMatchObject({ worldId: "world-1", sessionId: "session-1", title: "금지된 지도", sourceTranscriptIds: ["line-1"], relatedCanonIds: ["canon-1"], status: "proposed" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }));
  });

  it("응답이 제공되지 않은 근거 ID를 참조하면 거절한다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ title: "잘못된 근거", body: "첫 문장이다. 둘째 문장이다. 셋째 문장이다.", sourceTranscriptIds: ["outside"], relatedCanonIds: [] }) }),
    }));
    await expect(generateStoryDraft(request, { apiKey: "test-key", fetchImpl })).rejects.toThrow("초안이 제공되지 않은 대화 근거를 참조했습니다.");
  });
  it("세계 원고 조회는 소유자 범위 저장소 결과를 반환한다", async () => {
    const repository = { assertWorldOwned: vi.fn(async () => ({ id: "world-1" })), listWorldManuscript: vi.fn(async (worldId) => [{ id: "scene-1", worldId, order: 1 }]) };
    await expect(getWorldStory("world-1", { repository })).resolves.toEqual({ worldId: "world-1", scenes: [{ id: "scene-1", worldId: "world-1", order: 1 }] });
    expect(repository.listWorldManuscript).toHaveBeenCalledWith("world-1", { worldChecked: true });
  });
});

describe("이야기 초안 소유 범위와 재개", () => {
  function query(result = { data: [], error: null }) {
    const value = {
      insert: vi.fn(() => value), update: vi.fn(() => value), select: vi.fn(() => value), eq: vi.fn(() => value), order: vi.fn(() => value), limit: vi.fn(() => value),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return value;
  }

  it("초안을 저장하기 전에 해당 세계가 소유자에게 속하는지 확인한다", async () => {
    const worlds = query({ data: [], error: null });
    const supabase = { from: vi.fn(() => worlds) };
    const repository = createSupabaseRepository(supabase);
    await expect(repository.insertStoryDraft({ id: "draft-1", worldId: "other-world", title: "초안", body: "첫째 문장이다. 둘째 문장이다. 셋째 문장이다." }))
      .rejects.toMatchObject({ status: 403, code: "WORLD_ACCESS_DENIED" });
    expect(supabase.from).toHaveBeenCalledWith("worlds");
    expect(worlds.insert).not.toHaveBeenCalled();
  });

  it("세계별 초안을 최신순으로 재개하고 소유 초안을 보류한다", async () => {
    const worlds = query({ data: [{ id: "world-1" }], error: null });
    const drafts = query({ data: [{ id: "draft-1", world_id: "world-1", session_id: null, title: "지도", body: "본문", status: "proposed", source_transcript_ids: ["line-1"], related_canon_ids: [], parent_draft_id: null, created_at: "2026-07-31T00:00:00.000Z" }], error: null });
    const held = query({ data: [{ id: "draft-1", world_id: "world-1", status: "held" }], error: null });
    let storyDraftCalls = 0;
    const supabase = { from: vi.fn((table) => {
      if (table === "worlds") return worlds;
      storyDraftCalls += 1;
      return storyDraftCalls === 1 ? drafts : held;
    }) };
    const repository = createSupabaseRepository(supabase);
    await expect(repository.listStoryDrafts("world-1")).resolves.toEqual([expect.objectContaining({ id: "draft-1", worldId: "world-1", sourceTranscriptIds: ["line-1"] })]);
    await expect(repository.holdStoryDraft("world-1", "draft-1")).resolves.toMatchObject({ id: "draft-1", status: "held" });
    expect(drafts.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(held.update).toHaveBeenCalledWith({ status: "held" });
    expect(held.eq).toHaveBeenCalledWith("owner_id", "00000000-0000-0000-0000-000000000001");
  });

  it("서비스 계층은 초안 목록과 보류 전에 세계 소유 범위 저장소를 호출한다", async () => {
    const repository = { assertWorldOwned: vi.fn(async () => ({ id: "world-1" })), listStoryDrafts: vi.fn(async () => []), holdStoryDraft: vi.fn(async () => ({ id: "draft-1", status: "held" })) };
    await expect(listWorldDrafts("world-1", { repository })).resolves.toEqual({ worldId: "world-1", drafts: [] });
    await expect(holdSavedStoryDraft("world-1", "draft-1", { repository })).resolves.toEqual({ id: "draft-1", status: "held" });
    expect(repository.listStoryDrafts).toHaveBeenCalledWith("world-1", { worldChecked: true });
    expect(repository.holdStoryDraft).toHaveBeenCalledWith("world-1", "draft-1", { worldChecked: true });
  });
});