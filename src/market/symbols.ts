export function normalizeSymbol(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase().replace(/^\$/, "");
  return trimmed.includes(".") ? trimmed : `${trimmed}.US`;
}
