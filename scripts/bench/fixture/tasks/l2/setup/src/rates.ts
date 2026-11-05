export interface Rates {
  base: string;
  rates: Record<string, number>;
}

export interface RatesResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type Fetcher = (url: string) => Promise<RatesResponse>;

export async function fetchRates(fetcher: Fetcher, base: string): Promise<Rates> {
  const response = await fetcher(`https://rates.example/latest?base=${encodeURIComponent(base)}`);
  if (!response.ok) throw new Error(`Rates request failed with ${response.status}.`);
  return (await response.json()) as Rates;
}
