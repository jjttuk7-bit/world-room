import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("World Room 앱", () => {
  it("한국어 Realtime 음성 세션 시작 화면을 보여준다", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "World Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세션 시작/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세계 저장/ })).toBeDisabled();
    expect(screen.getByText("마이크 대기")).toBeInTheDocument();
  });
});
