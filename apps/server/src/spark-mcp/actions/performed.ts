export interface Performed {
  message: string;
  url: string | null;
  output?: Record<string, unknown>;
}
