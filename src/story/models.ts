export const storyDraftStatuses = ["proposed", "revising", "held", "accepted", "superseded"] as const;

export type StoryDraftStatus = (typeof storyDraftStatuses)[number];

export type StoryDraftRequest = {
  worldId: string;
  sessionId: string;
  prompt: string;
  transcriptIds: string[];
};

export type StoryDraft = {
  id: string;
  worldId: string;
  content: string;
  status: StoryDraftStatus;
  createdAt: string;
  parentDraftId?: string;
};

export type StoryScene = {
  id: string;
  worldId: string;
  draftId: string;
  content: string;
  order: number;
  acceptedAt: string;
};

export type StoryRevisionRequest = {
  id: string;
  content: string;
  createdAt: string;
};

export function holdDraft(draft: StoryDraft): StoryDraft {
  return { ...draft, status: "held" };
}

export function acceptDraft(
  draft: StoryDraft,
  acceptedScenes: StoryScene[],
  acceptedAt: string,
): { draft: StoryDraft; scene: StoryScene } {
  if (draft.status === "accepted" || acceptedScenes.some((scene) => scene.draftId === draft.id)) {
    throw new Error(`Draft ${draft.id} is already accepted`);
  }

  const order =
    acceptedScenes
      .filter((scene) => scene.worldId === draft.worldId)
      .reduce((highestOrder, scene) => Math.max(highestOrder, scene.order), 0) + 1;

  return {
    draft: { ...draft, status: "accepted" },
    scene: {
      id: `scene-${draft.id}`,
      worldId: draft.worldId,
      draftId: draft.id,
      content: draft.content,
      order,
      acceptedAt,
    },
  };
}

export function createRevision(draft: StoryDraft, request: StoryRevisionRequest): StoryDraft {
  return {
    id: request.id,
    worldId: draft.worldId,
    content: request.content,
    status: "proposed",
    createdAt: request.createdAt,
    parentDraftId: draft.id,
  };
}
