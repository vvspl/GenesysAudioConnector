import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import { Session } from '../websocket/session';
import { VoiceAIAgentBaseClass } from './voice-aiagent-base';
import { searchFlight, createItinerary } from './open-ai-tools';
import { getNoInputTimeout } from '../common/environment-variables';

// Retrieve the OpenAI API key from environment variables.
let { OPENAI_API_KEY } = process.env;
const OPENAI_MODEL_ENDPOINT = process.env.OPENAI_MODEL_ENDPOINT || 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

if (!OPENAI_API_KEY) {
    console.error(new Date().toISOString() + ':[OpenAI] Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

const INITIAL_GREETING = process.env.INITIAL_GREETING || 'Hello';
const VOICE = process.env.OPENAI_VOICE_ID || 'alloy';

const LOG_EVENT_TYPES = [
    'error',
    'response.done',
    'session.created',
    'session.updated',
    'response.output_item.done'
];

export class OpenAIRealTime extends VoiceAIAgentBaseClass {
    async sendKeepAlive(): Promise<void> {
        // Not Required for OpenAI Realtime API
    }
    
    private openAiWs: WebSocket;

    constructor(session: Session) {
        super(session, () => {
            console.log(new Date().toISOString() + ':' + '[OpenAI] NoInputTimer: Timeout reached');
            const noInputConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{
                        type: 'input_text',
                        text: process.env.NO_INPUT_MESSAGE || 'User did not provide any input. Act accordingly.'
                    }]
                }
            };
            this.openAiWs.send(JSON.stringify(noInputConversationItem));
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
        }, getNoInputTimeout());

        console.log(new Date().toISOString() + ':' + '[OpenAI] CONNECTING TO:', OPENAI_MODEL_ENDPOINT);
        
        // Авторизація без OpenAI-Beta заголовока (GA версія)
        this.openAiWs = new WebSocket(OPENAI_MODEL_ENDPOINT, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`
            }
        });

        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    type: "realtime", // Новий обов'язковий параметр
                    model: "gpt-4o-realtime-preview",
                    audio: {
                        input: { format: "g711_ulaw" },
                        output: { 
                            format: "g711_ulaw",
                            voice: VOICE 
                        }
                    },
                    turn_detection: {
                        type: "server_vad",
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 500,
                        create_response: true,
                        interrupt_response: true
                    },
                    instructions: this.getSystemMessage(),  
                    tools: this.getSystemTools(), 
                    tool_choice: "auto",
                    modalities: ["text", "audio"],
                    temperature: 0.8
                }
            };

            console.log(new Date().toISOString() + ':[OpenAI] InitializeSession (GA Update)');
            this.openAiWs.send(JSON.stringify(sessionUpdate));
            sendInitialConversationItem();
        };

        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{
                        type: 'input_text',
                        text: INITIAL_GREETING
                    }]
                }
            };
            this.openAiWs.send(JSON.stringify(initialConversationItem));
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
        };

        this.openAiWs.on('open', () => {
            console.log(new Date().toISOString() + ':[OpenAI] Connected to the OpenAI Realtime API');
            setTimeout(initializeSession, 100);
        });

        this.openAiWs.on('message', (data: string) => {
            try {
                const response = JSON.parse(data);
                
                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(new Date().toISOString() + ':' + `[OpenAI] Event: ${response.type}`);
                }

                // Обробка аудіо-дельти (GA назва події)
                if ((response.type === 'response.audio.delta' || response.type === 'response.output_audio.delta') && response.delta) {
                    this.session.sendAudio(new Uint8Array(Buffer.from(response.delta, 'base64')));
                }

                if (response.type === 'response.done') {
                    if (response.response.status === 'completed') {
                        this.session.flushBuffer();
                        
                        response.response.output.filter((out: any) => out.type === 'function_call').forEach((func_call: any) => {
                            const args = JSON.parse(func_call.arguments);
                            console.log(new Date().toISOString() + ':' + `[OpenAI] FunctionCall: ${func_call.name}`);

                            const responseData: any = {
                                type: "conversation.item.create",
                                item: {
                                    type: "function_call_output",
                                    call_id: func_call.call_id,
                                    output: ''
                                }
                            };

                            // ЛОГІКА ДЛЯ ДТЕК
                            if (func_call.name === "submitMeterReading") {
                                console.log('-----------------------------------------');
                                console.log('📊 DTEK METER DATA RECEIVED:');
                                console.log(`🏠 Address: ${args.fullAddress}`);
                                console.log(`🔌 Value: ${args.readingValue}`);
                                console.log('-----------------------------------------');
                                responseData.item.output = JSON.stringify({ status: "success", info: "recorded" });
                            
                            } else if (func_call.name === "transferToAgent") {
                                responseData.item.output = JSON.stringify({ status: "ok" });
                                session.sendDisconnect('completed', args.process, {});
                            
                            } else if (func_call.name === "endCall") {
                                session.sendDisconnect('completed', 'EndCall', {});
                            }

                            this.openAiWs.send(JSON.stringify(responseData));
                            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
                        });
                    }
                }

                if (response.type === 'input_audio_buffer.speech_started') {
                    this.noInputTimer.haltTimer();
                    this.session.sendBargeIn();
                }

                if (response.type === 'input_audio_buffer.speech_stopped') {
                    this.noInputTimer.resumeTimer();
                }

                if (response.type === 'error') {
                    console.error(new Date().toISOString() + ':[OpenAI] API Error:', JSON.stringify(response.error));
                }

            } catch (error) {
                console.error(new Date().toISOString() + ':[OpenAI] Processing Error:', error);
            }
        });
    }

    protected isAgentConnected(): boolean {
        return this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN;
    }

    async processAudio(audioPayload: Uint8Array): Promise<void> {
        if (this.isAgentConnected()) {
            this.openAiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: Buffer.from(audioPayload).toString('base64')
            }));
        }
    }

    async processPlaybackCompleted(): Promise<void> {
        if (this.isAgentConnected()) {
            this.noInputTimer.startTimer();
        }
    }

    cancelResponse() {
        if (this.isAgentConnected()) {
            this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
        }
    }

    async close(): Promise<void> {
        if (this.isAgentConnected()) {
            this.openAiWs.close();
        }
    }
}