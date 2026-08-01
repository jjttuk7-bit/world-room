export type CreativeBriefInput = {
  intent: string;
  conflict?: string;
  tone?: string;
  requiredElements?: readonly string[];
  sessionGoal?: string;
};

export type CreativeBrief = {
  intent: string;
  conflict: string;
  tone: string;
  requiredElements: string[];
  sessionGoal: string;
  approved: boolean;
};

function requiredText(value: string | undefined, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}이 필요합니다.`);
  return text;
}

function optionalText(value: string | undefined) {
  return String(value ?? "").trim();
}

export function createCreativeBrief(input: CreativeBriefInput): CreativeBrief {
  return {
    intent: requiredText(input.intent, "창작 의도"),
    conflict: optionalText(input.conflict),
    tone: optionalText(input.tone),
    requiredElements: (input.requiredElements ?? []).map((item) => String(item).trim()).filter(Boolean),
    sessionGoal: optionalText(input.sessionGoal),
    approved: false,
  };
}

export function approvedBriefOpeningContext(brief: CreativeBrief) {
  if (!brief.approved) return "";

  return [
    "오늘의 창작 브리프:",
    `창작 의도: ${brief.intent}`,
    brief.conflict && `핵심 갈등: ${brief.conflict}`,
    brief.tone && `분위기와 문체: ${brief.tone}`,
    brief.requiredElements.length > 0 && `반드시 포함할 요소: ${brief.requiredElements.join(", ")}`,
    brief.sessionGoal && `이번 대화의 목표: ${brief.sessionGoal}`,
    "새 이야기를 독단적으로 시작하지 말고, 이 브리프의 어느 지점부터 열지 한 가지 질문으로 물으세요.",
  ].filter(Boolean).join("\n");
}
