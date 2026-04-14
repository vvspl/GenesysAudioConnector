import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
import { getNoInputTimeout } from "../common/environment-variables";
import { MENU_INSTRUCTIONS } from "../prompts/Menu_Instructions";
import { MENU_TOOLS } from "../prompts/Menu_Tools";
import { AGENTS } from "../agents/agent-registry";

import * as fs from "fs";
import * as path from "path";

const { OPENAI_API_KEY, OPENAI_MODEL_ENDPOINT } = process.env;

export class OpenAIRealTime extends VoiceAIAgentBaseClass {
  private openAiWs: WebSocket;
  private tempAddressData: any = {};
  private fullTranscript: { role: string; content: string }[] = [];
  private hasStarted = false; // признак початку сесії

  async sendKeepAlive(): Promise<void> {}

  constructor(session: Session) {
    super(
      session,
      () => {
        console.log(
          `[${new Date().toISOString()}] 🕒 [NoInput] Таймаут! Користувач мовчить.`,
        );
      },
      getNoInputTimeout(),
    );

    console.log(
      `[${new Date().toISOString()}] 🔌 [OpenAI] Спроба підключення до: ${OPENAI_MODEL_ENDPOINT}`,
    );

    // Коннект WebSocket до OpenAI
    this.openAiWs = new WebSocket(OPENAI_MODEL_ENDPOINT, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    // Відкриваємо і лухаємо порт WebSocket
    this.openAiWs.on("open", () => {
      console.log(
        `[${new Date().toISOString()}] ✅ [OpenAI] З'єднання встановлено!`,
      );

      // СТАРТУЄМО З MENU
      const event = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: MENU_INSTRUCTIONS,
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: {
                // model: "gpt-4o-transcribe",
                model: "gpt-4o-mini-transcribe",
                language: "uk",
              },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: "alloy",
            },
          },
          tools: MENU_TOOLS, //
          tool_choice: "auto",
        },
      };

      // відправляємо НАЛАШТУВАННЯ СЕСІЇ
      this.openAiWs.send(JSON.stringify(event));
      console.log("🔥 session.update SENT");
      setTimeout(() => {
        if (!this.hasStarted) {
          console.log("🔥 fallback timeout triggered");
          this.hasStarted = true;

          console.log("🔥 response.create SENT (fallback)");

          this.openAiWs.send(
            JSON.stringify({
              type: "response.create",
            }),
          );
        }
      }, 1000);
    });

    // відправляємо голос
    this.openAiWs.on("message", async (data: any) => {
      console.log("🔥 message RECEIVED");
      const messageString = Buffer.isBuffer(data) ? data.toString() : data;

      try {
        const response = JSON.parse(messageString);
        console.log("🔥 response.type:", response.type);

        // AUDIO
        if (response.type === "response.output_audio.delta" && response.delta) {
          console.log("🔥 audio chunk RECEIVED");
          this.session.sendAudio(Buffer.from(response.delta, "base64"));
          return;
        }

        if (response.type === "session.updated" && !this.hasStarted) {
          console.log("🔥 session.updated RECEIVED");
          this.hasStarted = true;

          console.log("🔥 response.create SENT (session.updated)");

          this.openAiWs.send(
            JSON.stringify({
              type: "response.create",
            }),
          );
        }

        // Записуємо BOT TEXT в змінну fullTranscript
        if (response.type === "response.output_audio_transcript.done") {
          this.fullTranscript.push({
            role: "assistant",
            content: response.transcript,
          });
          console.log("🤖 AI:", response.transcript);
        }

        // Записуємо USER TEXT в змінну fullTranscript
        if (
          response.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          const userText = response.transcript?.trim();
          if (userText) {
            this.fullTranscript.push({ role: "user", content: userText });
            console.log("👤 Клієнт:", userText);
          }
        }

        // =============================
        // 🔥 ОСНОВНА ЛОГІКА
        // =============================
        if (response.type === "response.done") {
          console.log("🔥 response.done RECEIVED");
          const output = response.response?.output || [];
          console.log("🔥 output:", JSON.stringify(output, null, 2));

          // Якщо агентом викликана функція SWITCH AGENT
          const switchCall = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "switch_agent",
          );

          if (switchCall) {
            const args = JSON.parse(switchCall.arguments || "{}");
            const agentName = args.agent;

            console.log(`🔀 Switching to agent: ${agentName}`);

            const agent = AGENTS[agentName];
            if (!agent) return;

            // підтвердження tool call
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

            // 🔥 SWITCH
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
                        // model: "gpt-4o-transcribe",
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

            // Агент підключається і починає говорити першим:
            console.log("🔥 response.create SENT (after switch)");
            this.openAiWs.send(JSON.stringify({ type: "response.create" }));

            return;
          }

          // Якщо викликана функція завершення діалогу:
          const call = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "end_conversation",
          );

          if (call) {
            const args = JSON.parse(call.arguments || "{}");
            const reason = args.reason || "completed";

            this.tempAddressData = {
              full_address: args.full_address || "",
              city: args.city || "",
              street: args.street || "",
              house: args.house || "",
              apartment: args.apartment || "",
            };

            console.log("🏠 Дані:", this.tempAddressData);

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
                console.log("🔥 sendDisconnect CALLED", { reason });
                this.session.sendDisconnect(
                  "completed" as any,
                  "AI session finished",
                  {
                    reason: reason,
                    full_address: this.tempAddressData.full_address,
                    city: this.tempAddressData.city,
                    street: this.tempAddressData.street,
                    house: this.tempAddressData.house,
                    apartment: this.tempAddressData.apartment,
                    conversation_history: transcriptUrl,
                  },
                );

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
}
