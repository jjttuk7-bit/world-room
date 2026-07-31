export const storyDraftStatuses = ["proposed", "revising", "held", "accepted", "superseded"] as const;

export type StoryDraftStatus = (typeof storyDraftStatuses)[number];

const actionableStoryDraftStatuses = new Set<StoryDraftStatus>(["proposed", "revising"]);

export type StoryDraftRequest = {
  worldId: string;
  sessionId: string;
  prompt: string;
  transcriptIds: string[];
};

export type StoryDraft = {
  id: string;
  worldId: string;
  sourceTranscriptIds: readonly string[];
  relatedCanonIds: readonly string[];
  title: string;
  body: string;
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
  title: string;
  body: string;
  createdAt: string;
};

function assertCanTransitionDraft(draft: StoryDraft, nextStatus: "held" | "accepted") {
  if (actionableStoryDraftStatuses.has(draft.status)) {
    return;
  }

  if (nextStatus === "accepted" && draft.status === "accepted") {
    throw new Error(`Draft ${draft.id} is already accepted`);
  }

  throw new Error(`Draft ${draft.id} cannot be ${nextStatus} from status ${draft.status}`);
}

function preserveSources(draft: StoryDraft) {
  return {
    sourceTranscriptIds: [...draft.sourceTranscriptIds],
    relatedCanonIds: [...draft.relatedCanonIds],
  };
}

export function holdDraft(draft: StoryDraft): StoryDraft {
  assertCanTransitionDraft(draft, "held");
  return { ...draft, ...preserveSources(draft), status: "held" };
}

export function acceptDraft(
  draft: StoryDraft,
  acceptedScenes: StoryScene[],
  acceptedAt: string,
): { draft: StoryDraft; scene: StoryScene } {
  assertCanTransitionDraft(draft, "accepted");

  if (acceptedScenes.some((scene) => scene.draftId === draft.id)) {
    throw new Error(`Draft ${draft.id} is already accepted`);
  }

  const order =
    acceptedScenes
      .filter((scene) => scene.worldId === draft.worldId)
      .reduce((highestOrder, scene) => Math.max(highestOrder, scene.order), 0) + 1;

  return {
    draft: { ...draft, ...preserveSources(draft), status: "accepted" },
    scene: {
      id: `scene-${draft.id}`,
      worldId: draft.worldId,
      draftId: draft.id,
      content: draft.body,
      order,
      acceptedAt,
    },
  };
}

export function createRevision(draft: StoryDraft, request: StoryRevisionRequest): StoryDraft {
  return {
    id: request.id,
    worldId: draft.worldId,
    ...preserveSources(draft),
    title: request.title,
    body: request.body,
    status: "proposed",
    createdAt: request.createdAt,
    parentDraftId: draft.id,
  };
}
