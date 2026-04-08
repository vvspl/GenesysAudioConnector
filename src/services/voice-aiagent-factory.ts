import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
import { OpenAIRealTime } from "./open-ai"; // Adjust path if needed
import { Session } from "../websocket/session";

export class VoiceAIAgentFactory {
  static create(agentName: string, session: Session): VoiceAIAgentBaseClass {
    const name = agentName.toLowerCase();
    if (name === "openai") {
      console.log(
        new Date().toISOString() +
          ":" +
          `[VoiceAIAgentFactory] Creating OpenAIRealTime agent.`,
      );
      return new OpenAIRealTime(session);
    } else {
      throw new Error(`[VoiceAIAgentFactory] Unknown BOT_TYPE: ${agentName}`);
    }
  }
}
