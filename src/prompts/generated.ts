import type { AgentProfile } from "../types.js";

function formatSpecialistLine(profile: AgentProfile): string {
  return `- \`${profile.id}\`: ${profile.description}`;
}

export function buildAvailableSpecialistsList(
  profiles: AgentProfile[],
): string {
  return profiles.map(formatSpecialistLine).join("\n");
}
