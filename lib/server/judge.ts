export interface JudgeInput {
  transcript: string;
  context: string[];
}

export interface JudgeResult {
  aiScoreDelta: number;
  humanScoreDelta: number;
  rationale: string;
}

export interface JudgeProvider {
  judge(input: JudgeInput): Promise<JudgeResult | null>;
}

export class DisabledJudgeProvider implements JudgeProvider {
  async judge(input: JudgeInput): Promise<JudgeResult | null> {
    void input;
    return null;
  }
}

export function getJudgeProvider(): JudgeProvider {
  return new DisabledJudgeProvider();
}
