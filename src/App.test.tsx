import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/worlds/recent")) {
        return {
          ok: true,
          json: async () => ({
            worlds: [
              {
                id: "world-1",
                title: "안개 도시",
                summary: "밤마다 골목이 바뀌는 도시.",
                continuityBrief: "안개 도시와 사라진 지도 제작자를 이어간다.",
                updatedAt: "2026-05-27T18:33:21.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

describe("World Room 앱", () => {
  it("한국어 Realtime 음성 세션 시작 화면을 보여준다", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "World Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세션 시작/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세계 저장/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "설정: 아직 비어 있는 지도" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "떠다니는 항구 도시를 같이 만들어보자." })).toBeDisabled();
    expect(screen.getByText("마이크 대기")).toBeInTheDocument();
    expect(screen.queryByText("/api/token")).not.toBeInTheDocument();
    expect(screen.queryByText("API 키는 브라우저가 아니라 로컬 서버에만 둡니다.")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "최근 세계" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ })).toBeInTheDocument();
  });
});
