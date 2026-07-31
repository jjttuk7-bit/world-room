import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/worlds/") && options?.method === "DELETE") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (url.includes("/worlds/recent")) {
        return { ok: true, json: async () => ({ worlds: [{ id: "world-1", title: "안개 도시", summary: "밤마다 골목이 바뀌는 도시.", continuityBrief: "안개 도시와 사라진 지도 제작자를 이어간다.", updatedAt: "2026-05-27T18:33:21.000Z" }] }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => cleanup());

describe("World Room 앱", () => {
  it("대시보드 대신 작가용 세 가지 작업 모드를 보여준다", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "World Room" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "작업 모드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대화" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "원고" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "세계 성경" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "말로 다음 장면을 찾아보세요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /대화 시작/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세계 저장" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "최근 세계" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세계 이름")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세계 씨앗")).not.toBeInTheDocument();
  });

  it("새 세계 설정은 필요할 때 열리는 대화상자에만 둔다", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    expect(screen.getByRole("dialog", { name: "새 세계 열기" })).toBeInTheDocument();
    expect(screen.getByLabelText("세계 이름")).toHaveValue("");
    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("세계 씨앗"), { target: { value: "비가 위로 내리는 항구 도시" } });
    fireEvent.click(screen.getByRole("button", { name: "어두운" }));
    fireEvent.click(screen.getByRole("button", { name: "미스터리" }));
    fireEvent.click(screen.getByRole("button", { name: "선택지 제안" }));
    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("비가 위로 내리는 항구 도시");
    expect(screen.getByRole("button", { name: "어두운" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "미스터리" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "선택지 제안" })).toHaveAttribute("aria-pressed", "true");
  });

  it("원고와 세계 성경 모드에서 각각의 작업 맥락을 연다", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    expect(screen.getByRole("heading", { name: "원고" })).toBeInTheDocument();
    expect(screen.getByText("채택한 장면이 이곳에서 한 편의 이야기로 이어집니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "세계 성경" }));
    expect(screen.getByRole("heading", { name: "세계 성경" })).toBeInTheDocument();
    expect(screen.getByText("인물, 장소, 규칙과 사건을 대화의 근거와 함께 보관합니다.")).toBeInTheDocument();
  });

  it("보관함에서만 저장한 세계 목록을 연다", async () => {
    render(<App />);
    expect(screen.queryByRole("heading", { name: "최근 세계" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    expect(await screen.findByRole("heading", { name: "최근 세계" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ })).toBeInTheDocument();
  });

  it("저장된 세계를 삭제할 수 있다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 삭제/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1", { method: "DELETE" }));
  });
});
