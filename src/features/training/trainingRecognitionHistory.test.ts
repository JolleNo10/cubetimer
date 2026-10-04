import { afterEach, expect, it, vi } from "vitest";
import * as db from "../../infrastructure/persistence/db";
import { createTrainingRecognitionAttempt, loadTrainingRecognitionAttempts, saveTrainingRecognitionAttempt } from "./trainingRecognitionHistory";
afterEach(() => vi.restoreAllMocks());
it("constructs a separate stable historical fact and delegates persistence", async () => {
  vi.spyOn(Date, "now").mockReturnValue(200);
  const attempt = createTrainingRecognitionAttempt({ drillRunId: "run", drillRound: 3,
    target: { family: "pll", trainingSet: "full", caseId: "T" }, answerCaseId: "Ua", responseMs: 1500 });
  expect(attempt).toMatchObject({ createdAt: 200, drillRunId: "run", drillRound: 3, answerCaseId: "Ua" });
  expect(attempt.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempt).not.toHaveProperty("isCorrect"); expect(attempt).not.toHaveProperty("sessionId");
  vi.spyOn(db, "loadTrainingRecognitionAttempts").mockResolvedValue([attempt]);
  const save = vi.spyOn(db, "saveTrainingRecognitionAttempt").mockResolvedValue();
  expect(await loadTrainingRecognitionAttempts()).toEqual([attempt]);
  await saveTrainingRecognitionAttempt(attempt); expect(save).toHaveBeenCalledExactlyOnceWith(attempt);
  save.mockRejectedValue(new Error("disk full")); await expect(saveTrainingRecognitionAttempt(attempt)).rejects.toThrow("disk full");
});
