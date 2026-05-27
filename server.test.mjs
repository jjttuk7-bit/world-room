import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSessionRecord, saveSessionRecord } from "./server.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "world-room-"));
  tempDirs.push(dir);
  return dir;
}

describe("World Room 세션 저장", () => {
  it("transcript와 sparks를 sessions JSON 파일로 저장한다", async () => {
    const sessionsDir = await makeTempDir();

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
        sessionsDir,
        model: "gpt-realtime-2",
        voice: "marin",
        now: new Date("2026-05-27T18:33:21+09:00"),
      },
    );

    expect(result).toEqual({
      ok: true,
      path: "sessions/20260527-183321-world-room.json",
    });

    const saved = JSON.parse(await readFile(join(sessionsDir, "20260527-183321-world-room.json"), "utf8"));
    expect(saved).toMatchObject({
      id: "20260527-183321-world-room",
      title: "나는 도시",
      model: "gpt-realtime-2",
      voice: "marin",
      transcript: [
        { id: "1", speaker: "사용자", text: "나는 도시", final: true },
        { id: "2", speaker: "동반자", text: "설정: 비가 거꾸로 오는 도시", final: true },
      ],
      sparks: ["설정: 비가 거꾸로 오는 도시"],
    });
    expect(JSON.stringify(saved)).not.toContain("sk-");
    expect(JSON.stringify(saved)).not.toContain("client_secret");
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
});
