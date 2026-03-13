import type { MemoryArtifact } from "../types.js";

export function formatMemoryArtifactCategory(category: MemoryArtifact["category"]): string {
  switch (category) {
    case "bootstrap":
      return "bootstrap memory";
    case "daily":
      return "daily flush";
    case "archive":
      return "session archive";
    case "knowledge":
      return "durable knowledge";
    case "portfolio":
      return "portfolio summary";
    default:
      return "other";
  }
}
