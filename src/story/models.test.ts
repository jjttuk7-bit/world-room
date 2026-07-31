import { describe, expect, it } from "vitest";
import {
  acceptDraft,
  createRevision,
  holdDraft,
  storyDraftStatuses,
  type StoryDraft,
  type StoryScene,
} from "./models";

const proposedDraft: StoryDraft = {
  id: "draft-1",
  worldId: "world-1",
  content: "비가 멈추지 않는 해저 도시에서 잠수사가 지도를 발견했다.",
  status: "proposed",
  createdAt: "2026-07-31T00:00:00.000Z",
};

describe("이야기 초안 상태", () => {
  it("초안은 전체 수명 주기 상태 집합만 사용한다", () => {
    expect(storyDraftStatuses).toEqual(["proposed", "revising", "held", "accepted", "superseded"]);
    expect(new Set(storyDraftStatuses).size).toBe(storyDraftStatuses.length);
  });

  it("제안된 초안을 보류 상태로 바꾸되 원본은 유지한다", () => {
    const held = holdDraft(proposedDraft);

    expect(held).toMatchObject({ id: "draft-1", status: "held" });
    expect(proposedDraft.status).toBe("proposed");
  });

  it("제안된 초안을 채택하면 다음 순서의 정식 장면을 만든다", () => {
    const scenes: StoryScene[] = [
      {
        id: "scene-2",
        worldId: "world-1",
        draftId: "draft-0",
        content: "앞선 장면",
        order: 2,
        acceptedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "scene-1",
        worldId: "world-1",
        draftId: "draft--1",
        content: "첫 장면",
        order: 1,
        acceptedAt: "2026-07-29T00:00:00.000Z",
      },
    ];

    const accepted = acceptDraft(proposedDraft, scenes, "2026-07-31T01:00:00.000Z");

    expect(accepted.draft.status).toBe("accepted");
    expect(accepted.scene).toMatchObject({
      id: "scene-draft-1",
      worldId: "world-1",
      draftId: "draft-1",
      content: proposedDraft.content,
      order: 3,
      acceptedAt: "2026-07-31T01:00:00.000Z",
    });
    expect(scenes.map((scene) => scene.order)).toEqual([2, 1]);
  });

  it("다른 세계의 장면은 다음 순서 계산에서 제외한다", () => {
    const scenes: StoryScene[] = [
      {
        id: "scene-current-world",
        worldId: "world-1",
        draftId: "draft-0",
        content: "현재 세계 장면",
        order: 2,
        acceptedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "scene-other-world",
        worldId: "world-2",
        draftId: "draft-other",
        content: "다른 세계 장면",
        order: 99,
        acceptedAt: "2026-07-30T00:00:00.000Z",
      },
    ];

    const accepted = acceptDraft(proposedDraft, scenes, "2026-07-31T01:00:00.000Z");

    expect(accepted.scene.order).toBe(3);
  });

  it("이미 채택한 초안을 다시 채택하려 하면 오류를 던진다", () => {
    const acceptedDraft: StoryDraft = { ...proposedDraft, status: "accepted" };

    expect(() => acceptDraft(acceptedDraft, [], "2026-07-31T01:00:00.000Z")).toThrow(
      "already accepted",
    );
  });

  it("오래된 제안 초안도 이미 장면이 있으면 다시 채택할 수 없다", () => {
    const staleDraft: StoryDraft = { ...proposedDraft, status: "proposed" };
    const scenes: StoryScene[] = [
      {
        id: "scene-draft-1",
        worldId: "world-1",
        draftId: "draft-1",
        content: proposedDraft.content,
        order: 1,
        acceptedAt: "2026-07-31T01:00:00.000Z",
      },
    ];

    expect(() => acceptDraft(staleDraft, scenes, "2026-07-31T02:00:00.000Z")).toThrow(
      "already accepted",
    );
  });

  it("수정 요청은 부모 초안에 연결된 별도의 제안 초안을 만든다", () => {
    const revision = createRevision(proposedDraft, {
      id: "draft-2",
      content: "해저 도시의 항구에서 잠수사가 금지된 지도를 펼쳤다.",
      createdAt: "2026-07-31T02:00:00.000Z",
    });

    expect(revision).toEqual({
      id: "draft-2",
      worldId: "world-1",
      content: "해저 도시의 항구에서 잠수사가 금지된 지도를 펼쳤다.",
      status: "proposed",
      createdAt: "2026-07-31T02:00:00.000Z",
      parentDraftId: "draft-1",
    });
    expect(revision).not.toBe(proposedDraft);
    expect(proposedDraft.parentDraftId).toBeUndefined();
  });
});
