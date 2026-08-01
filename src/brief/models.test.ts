import { describe, expect, it } from "vitest";
import {
  approvedBriefOpeningContext,
  createCreativeBrief,
  type CreativeBrief,
} from "./models";

const completeBrief = {
  intent: "기억을 잃은 잠수사의 첫 귀환 장면을 만든다.",
  conflict: "수면 위로 가면 도시가 붕괴하지만, 주인공은 잃어버린 가족을 찾아야 한다.",
  tone: "고요하고 불길한 해양 SF",
  requiredElements: ["역류하는 비", "금지된 지도"],
  sessionGoal: "첫 장면의 갈등과 선택을 확정한다.",
};

describe("창작 브리프", () => {
  it("다섯 필드를 가진 브리프를 만들고 의도를 필수로 요구한다", () => {
    expect(createCreativeBrief(completeBrief)).toEqual({ ...completeBrief, approved: false });
    expect(() => createCreativeBrief({ ...completeBrief, intent: "  " })).toThrow("창작 의도");
  });

  it("승인된 브리프만 음성 대화의 시작 맥락으로 변환한다", () => {
    const pending = createCreativeBrief(completeBrief);
    const approved: CreativeBrief = { ...pending, approved: true };

    expect(approvedBriefOpeningContext(pending)).toBe("");
    expect(approvedBriefOpeningContext(approved)).toContain("기억을 잃은 잠수사");
    expect(approvedBriefOpeningContext(approved)).toContain("금지된 지도");
  });
});
