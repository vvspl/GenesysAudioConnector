import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
import { MENU_INSTRUCTIONS } from "../prompts/Menu_Instructions";
import { MENU_TOOLS } from "../prompts/Menu_Tools";
import { AGENTS } from "../agents/agent-registry";

import * as fs from "fs";
import * as path from "path";

const { OPENAI_API_KEY, OPENAI_MODEL_ENDPOINT, NO_INPUT_TIMEOUT } = process.env;

export class OpenAIRealTime {
  private openAiWs: WebSocket;
  private tempAddressData: any = {};
  private fullTranscript: { role: string; content: string }[] = [];

  private hasPendingUserTurn = false; // 🔥 є новий user input
  private noInputTimer: NodeJS.Timeout | null = null;
  private session: Session;

  private isUserSpeaking = false;
  private userSpeechTimeout: NodeJS.Timeout | null = null;

  constructor(session: Session) {
    this.session = session;

    console.log(`🔌 [OpenAI] Connecting: ${OPENAI_MODEL_ENDPOINT}`);

    this.openAiWs = new WebSocket(OPENAI_MODEL_ENDPOINT, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    this.openAiWs.on("open", () => {
      console.log(`[${new Date().toISOString()}] ✅ Connected`);

      const event = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: MENU_INSTRUCTIONS,
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "uk",
              },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: "alloy",
            },
          },
          tools: MENU_TOOLS,
          tool_choice: "auto",
        },
      };

      this.openAiWs.send(JSON.stringify(event));
      console.log("🔥 session.update SENT");
    });

    this.bindWsEvents();
  }
  // =============================
  // Основна логіка
  // =============================
  private bindWsEvents() {
    this.openAiWs.on("message", async (data: any) => {
      const messageString = Buffer.isBuffer(data) ? data.toString() : data;

      try {
        const response = JSON.parse(messageString);

        console.log("🔥", response.type);

        // =============================
        // 🎤 USER SPEECH
        // =============================

        if (response.type === "input_audio_buffer.speech_started") {
          this.isUserSpeaking = true;

          if (this.userSpeechTimeout) {
            clearTimeout(this.userSpeechTimeout);
            this.userSpeechTimeout = null;
          }

          this.clearNoInputTimer();
        }

        if (response.type === "input_audio_buffer.speech_stopped") {
          this.isUserSpeaking = false;

          if (this.userSpeechTimeout) {
            clearTimeout(this.userSpeechTimeout);
          }

          // ⏳ debounce перед відповіддю
          this.userSpeechTimeout = setTimeout(() => {
            if (this.isUserSpeaking) return;

            if (!this.hasPendingUserTurn) {
              console.log("🚫 no user turn → skip");
              return;
            }

            console.log("✅ response.create (user finished)");

            this.openAiWs.send(
              JSON.stringify({
                type: "response.create",
              }),
            );
          }, 800);
        }

        // =============================
        // 🔊 AUDIO OUTPUT
        // =============================

        if (response.type === "response.output_audio.delta" && response.delta) {
          this.session.sendAudio(Buffer.from(response.delta, "base64"));
          return;
        }

        // =============================
        // 📝 TRANSCRIPTS
        // =============================

        if (response.type === "response.output_audio_transcript.done") {
          this.fullTranscript.push({
            role: "assistant",
            content: response.transcript,
          });

          console.log("🤖 AI:", response.transcript);
        }

        if (
          response.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          const userText = response.transcript?.trim();

          if (!userText || userText.length < 3) {
            console.log("⚠️ ignore noise");
            return;
          }

          this.fullTranscript.push({
            role: "user",
            content: userText,
          });

          this.hasPendingUserTurn = true;

          console.log("👤 User:", userText);

          this.clearNoInputTimer();
        }

        // =============================
        // 🤖 RESPONSE DONE
        // =============================

        if (response.type === "response.done") {
          const output = response.response?.output || [];

          console.log("🔥 DONE:", JSON.stringify(output, null, 2));

          // ⬇️ завершили цикл
          this.hasPendingUserTurn = false;

          // =============================
          // 🔀 SWITCH AGENT
          // =============================

          const switchCall = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "switch_agent",
          );

          if (switchCall) {
            const args = JSON.parse(switchCall.arguments || "{}");
            const agent = AGENTS[args.agent];

            if (!agent) return;

            this.openAiWs.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: switchCall.call_id,
                  output: JSON.stringify({ status: "ok" }),
                },
              }),
            );

            this.openAiWs.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  type: "realtime",
                  instructions: agent.instructions,
                  tools: agent.tools,
                  tool_choice: "auto",
                  audio: {
                    input: {
                      format: { type: "audio/pcmu" },
                      transcription: {
                        model: "gpt-4o-mini-transcribe",
                        language: "uk",
                      },
                    },
                    output: {
                      format: { type: "audio/pcmu" },
                      voice: "alloy",
                    },
                  },
                },
              }),
            );

            // ❗ НЕ запускаємо відповідь автоматично
            this.hasPendingUserTurn = false;

            return;
          }

          // =============================
          // 🏁 END CONVERSATION
          // =============================

          const call = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "end_conversation",
          );

          if (call) {
            const args = JSON.parse(call.arguments || "{}");

            this.tempAddressData = {
              full_address: args.full_address || "",
              city: args.city || "",
              street: args.street || "",
              house: args.house || "",
              apartment: args.apartment || "",
            };

            this.openAiWs.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: call.call_id,
                  output: JSON.stringify({ status: "success" }),
                },
              }),
            );

            const conversationId =
              (this.session as any).conversationId || "unknown";

            this.saveTranscriptAndGetUrl(conversationId).then(
              (transcriptUrl) => {
                this.session.sendDisconnect("completed" as any, "AI finished", {
                  ...this.tempAddressData,
                  conversation_history: transcriptUrl,
                });

                setTimeout(() => this.session.close(), 500);
              },
            );

            return;
          }
        }

        if (response.type === "error") {
          console.error("❌ OpenAI Error:", response.error);
        }
      } catch (err) {
        console.error("❌ Parse error:", err);
      }
    });
  }

  protected isAgentConnected(): boolean {
    return this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN;
  }

  async processAudio(audioPayload: Uint8Array): Promise<void> {
    if (this.isAgentConnected()) {
      this.openAiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: Buffer.from(audioPayload).toString("base64"),
        }),
      );
    }
  }

  cancelResponse() {
    if (this.isAgentConnected()) {
      this.openAiWs.send(JSON.stringify({ type: "response.cancel" }));
    }
  }

  async close(): Promise<void> {
    if (this.openAiWs) {
      this.openAiWs.close();
    }
  }

  private async saveTranscriptAndGetUrl(
    conversationId: string,
  ): Promise<string> {
    const logDir = path.join(__dirname, "../../public/logs");

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const fileName = `${conversationId}.txt`;
    const filePath = path.join(logDir, fileName);

    const chatText = this.fullTranscript
      .map((t) => `${t.role === "user" ? "Клієнт" : "Бот"}: ${t.content}`)
      .join("\n");

    fs.writeFileSync(filePath, chatText, "utf8");

    const baseUrl = process.env.NGROK_STATIC_URL;
    return `${baseUrl}/logs/${fileName}`;
  }

  private startNoInputTimer() {
    this.clearNoInputTimer();

    const timeout = Number(NO_INPUT_TIMEOUT) || 8000;

    this.noInputTimer = setTimeout(() => {
      if (this.isUserSpeaking) return;
      if (this.hasPendingUserTurn) return;

      console.log("🕒 no input → reprompt");

      this.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: "Клієнт мовчить. Запитай ще раз коротко.",
          },
        }),
      );
    }, timeout);
  }

  private clearNoInputTimer() {
    if (this.noInputTimer) {
      clearTimeout(this.noInputTimer);
      this.noInputTimer = null;
    }
  }
}
