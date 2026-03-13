import type { AgentProfileRegistry } from "../control/agent-profiles.js";
import type { SkillRegistry } from "../skills/registry.js";
import { buildAvailableSpecialistsList } from "./generated.js";

export function createPromptVariables(
  profiles: AgentProfileRegistry,
  skills?: Pick<SkillRegistry, "buildPrompt">,
): Record<string, () => Promise<string> | string> {
  return {
    SPECIALIST_LIST: () => {
      const specialists = profiles.getRootSpawnableProfiles().map((profileId) => profiles.get(profileId));
      return buildAvailableSpecialistsList(specialists);
    },
    AVAILABLE_SKILLS: () => skills?.buildPrompt() ?? "",
  };
}
