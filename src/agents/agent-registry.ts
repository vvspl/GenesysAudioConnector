import { MENU_INSTRUCTIONS } from "../prompts/Menu_Instructions";
import { MENU_TOOLS } from "../prompts/Menu_Tools";
import { METER_INSTRUCTIONS } from "../prompts/Meter_Instructions";
import { METER_TOOLS } from "../prompts/Meter_Tools";
import { OUTAGE_INSTRUCTIONS } from "../prompts/Outage_Instructions";
import { OUTAGE_TOOLS } from "../prompts/Outage_Tools";
import { CONTRACT_INSTRUCTIONS } from "../prompts/Contract_Instructions";
import { CONTRACT_TOOLS } from "../prompts/Contract_Tools";

export const AGENTS = {
  menu: {
    instructions: MENU_INSTRUCTIONS,
    tools: MENU_TOOLS,
  },
  meter: {
    instructions: METER_INSTRUCTIONS,
    tools: METER_TOOLS,
  },

  outage: {
    instructions: OUTAGE_INSTRUCTIONS,
    tools: OUTAGE_TOOLS,
  },

  contract: {
    instructions: CONTRACT_INSTRUCTIONS,
    tools: CONTRACT_TOOLS,
  },
};
