import { DTEK_INSTRUCTIONS } from "../prompts/DTEK_Instructions";
import { DTEK_TOOLS } from "../prompts/DTEK_Tools";

export const AGENTS = {
  meter: {
    instructions: DTEK_INSTRUCTIONS,
    tools: DTEK_TOOLS,
  },

  outage: {
    instructions: "Тут буде outage агент",
    tools: [],
  },

  weather: {
    instructions: "Тут буде weather агент",
    tools: [],
  },
};
