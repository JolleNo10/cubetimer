import { useController, useTrainingState } from "../../../app/useController";
import { formatTime } from "../../../shared/time";

/** Runtime owns the offered choices, correctness and publication-to-answer timing. */
export function TrainingRecognition() {
  const controller = useController(), training = useTrainingState(), recognition = training.recognition;
  if (training.drill.task !== "recognition" || !recognition) return null;
  if (recognition.result) {
    const result = recognition.result, label = (id: string) => recognition.choices.find(c => c.caseId === id)?.label ?? id;
    return <section className="training-recognition-result" aria-label="Recognition result" role="status">
      <strong>{result.correct ? "Correct" : "Incorrect"}</strong>
      <p>Correct case: {label(result.correctCaseId)} · Your answer: {label(result.answerCaseId)}</p>
      <p>{formatTime(result.responseMs)} response</p>
    </section>;
  }
  if (training.phase !== "ready") return null;
  return <section aria-label="Recognition choices"><p>Identify the case.</p>
    <div className="training-recognition-choices">{recognition.choices.map(choice => <button key={choice.caseId}
      onClick={() => controller.submitTrainingRecognition(choice.caseId)}>{choice.label}</button>)}</div>
  </section>;
}
