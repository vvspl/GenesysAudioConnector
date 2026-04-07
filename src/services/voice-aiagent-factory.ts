import { VoiceAIAgentBaseClass } from './voice-aiagent-base';
import { DeepgramAIVoiceAgent } from './deepgram';
import { OpenAIRealTime } from './open-ai'; // Adjust path if needed
import { Session } from '../websocket/session';

export class VoiceAIAgentFactory {
    static create(agentName: string, session: Session): VoiceAIAgentBaseClass {
        const name = (agentName || 'DeepGram').toLowerCase();
        if (name === 'openai') {
            console.log(new Date().toISOString()+':'+`[VoiceAIAgentFactory] Creating OpenAIRealTime agent.`);
            return new OpenAIRealTime(session);
        } else if (name === 'deepgram') {
            console.log(new Date().toISOString()+':'+`[VoiceAIAgentFactory] Creating DeepgramAIVoiceAgent.`);
            return new DeepgramAIVoiceAgent(session);
        } else {
            throw new Error(`[VoiceAIAgentFactory] Unknown BOT_TYPE: ${agentName}`);
        }
    }
}