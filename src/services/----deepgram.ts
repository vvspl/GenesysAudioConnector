
import WS,{ WebSocket } from 'ws';

import {
    Session
} from '../websocket/session';

import { getNoInputTimeout } from '../common/environment-variables';

import { VoiceAIAgentBaseClass } from './voice-aiagent-base';

let { DEEPGRAM_API_KEY: DEEPGRAM_API_KEY } = process.env;
if (!DEEPGRAM_API_KEY) {
    console.error(new Date().toISOString()+ ':[DeepGram]Missing DeepGram API key. Please set it in the .env file.');
    process.exit(1);
}

// Constants
const AGENT_GREETING = process.env.INITIAL_GREETING || 'Hello';
const DEEPGRAM_SPEAK_VOICE = process.env.DEEPGRAM_SPEAK_VOICE || 'aura-asteria-en';

const DEEPGRAM_API_ENDPOINT = process.env.DEEPGRAM_ENDPOINT || 'wss://agent.deepgram.com/v1/agent/converse';
const DEEPGRAM_LISTEN_MODEL = process.env.DEEPGRAM_LISTEN_MODEL || 'nova-2-phonecall';
const DEEPGRAM_THINK_PROVIDER_TYPE = process.env.DEEPGRAM_THINK_PROVIDER_TYPE || 'openai'   ;
const DEEPGRAM_THINK_PROVIDER_MODEL = process.env.DEEPGRAM_THINK_PROVIDER_MODEL || 'gpt-4o-mini';



// List of Event Types to log to the console. 
const LOG_EVENT_TYPES = [
    'Warning',
    'UserStartedSpeaking',
    'AgentThinking',
    'PromptUpdated',
    'SettingsApplied',
    'AgentAudioDone',
    'InjectionRefused',
    'Welcome',
    'ConversationText',
    'UserStartedSpeaking',
    'AgentThinking',
    'FunctionCallRequest',
    'FunctionCalling',
    'AgentStartedSpeaking',
    'AgentAudioDone',
    'Error'
];



export class DeepgramAIVoiceAgent extends VoiceAIAgentBaseClass{
    private deepgramWs:WebSocket ;
    
    constructor(session:Session){
        super(session, () => {
            console.log(new Date().toISOString() + ':' + '[DeepGram]Not Implemented:No Input Callback for DeepgramAIVoiceAgent');
        }, getNoInputTimeout()); // 30 seconds no input timeout

        this.deepgramWs = new WebSocket(DEEPGRAM_API_ENDPOINT, {
            headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`
            }
        });
        // Initialize Deepgram VoiceAgent session    
        // Open event for Deepgram WebSocket
        this.deepgramWs.on('open', () => {
            console.log(new Date().toISOString() + ':' + '[DeepGram]Connected to the Deepgram VoiceAgent');
        });
        this.deepgramWs.on('message', (data:WS.RawData, isBinary: boolean) => {
            if (isBinary) {
                console.log(new Date().toISOString() + ':[DeepGram]:Received Binary Message');
                this.session.sendAudio(data as Uint8Array);
            }
            else {
                console.log(new Date().toISOString() + ':[DeepGram]:Received Text Message');
                this.processTextMessageprocessTextMessage(data.toString());
            }
        });
    }
    protected isAgentConnected(): boolean {
        return this.deepgramWs && this.deepgramWs.readyState === WebSocket.OPEN;
    }
    async sendKeepAlive(): Promise<void> {
        if(this.deepgramWs.readyState== WebSocket.OPEN) {
            const KeepAlivePayload = {
                "type": "KeepAlive"
            };
    
            console.log(new Date().toISOString() + ':[DeepGram]Sending KeepAlive');
            this.deepgramWs.send(JSON.stringify(KeepAlivePayload));
        }
        
    }
    async close(): Promise<void>{
        if(this.deepgramWs.readyState==WebSocket.OPEN){
                console.log(new Date().toISOString()+':'+'[DeepGram]Closing Deepgram Connection');
                this.deepgramWs.close();
        }
    }
    async processAudio(data:Uint8Array): Promise<void>{
        if(this.deepgramWs.readyState== WebSocket.OPEN) {
            this.deepgramWs.send(data,{binary:true});
        }
    }
    private processTextMessageprocessTextMessage(data:string){
        try {
            const response = JSON.parse(data);
            if (LOG_EVENT_TYPES.includes(response.type)) {
                console.log(new Date().toISOString() + ':' + `[DeepGram]Received event: ${response.type}`, JSON.stringify(response));
            }
            if(response.type === 'Welcome'){
                const initializeSession = () => {
                    const settingsConfiguration = {
                        "type": "Settings",
                        "audio": {
                            "input": {
                                "encoding": "mulaw",
                                "sample_rate": 8000
                            },
                            "output": {
                                "encoding": "mulaw",
                                "sample_rate": 8000,
                                "container": "none"
                            }
                        },
                        "agent": {
                            "greeting": AGENT_GREETING,
                            "listen": {
                                "provider": {
                                    "type": "deepgram",
                                    "model": DEEPGRAM_LISTEN_MODEL    
                                },
                                
                            },
                            "think": {
                                "provider": {
                                    "type": DEEPGRAM_THINK_PROVIDER_TYPE,
                                    "model": DEEPGRAM_THINK_PROVIDER_MODEL
                                },
                                "prompt": this.getSystemMessage()
                                
                                // ... additional think options including instructions and functions available
                            },
                            "speak": {
                                "provider": {
                                    "type": "deepgram",
                                    "model": DEEPGRAM_SPEAK_VOICE
                                }
                                
                            }
                        }
                        // ... additional top-level options including context available
                    };
                    console.log(new Date().toISOString()+ '[DeepGram]Sending settings Configuration update:', JSON.stringify(settingsConfiguration));
                    this.deepgramWs.send(JSON.stringify(settingsConfiguration));
                    
                };
                initializeSession();
            }
            if(response.type === 'SettingsApplied'){
                console.log(new Date().toISOString() + ':' + '[DeepGram]:SettingsApplied');
            }
            if (response.type === 'UserStartedSpeaking') {
                if (this.session.getIsAudioPlaying()) {
                    console.log(new Date().toISOString() + ':' + '[DeepGram]:UserStartedSpeaking|Sending BargeIn');
                    this.session.sendBargeIn();
                }
                this.session.setIsAudioPlaying(false);
            }
            if (response.type === 'AgentAudioDone') {
                console.log(new Date().toISOString() + ':' + `[DeepGram]AgentAudioDone|Flushing Buffer`);
                this.session.flushBuffer();
            }
        }
        catch (error) {
            console.error(new Date().toISOString()+ ':[DeepGram]Error processing Deepgram message:', error, 'Raw message:', data);
        }
    }
}