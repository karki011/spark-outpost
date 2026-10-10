export interface ChoiceDistribution {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
