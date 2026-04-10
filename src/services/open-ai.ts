import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
import { getNoInputTimeout } from "../common/environment-variables";
import { DTEK_INSTRUCTIONS } from "../prompts/DTEK_Instructions";
import { DTEK_TOOLS } from "../prompts/DTEK_Tools";

import * as fs from "fs";
import * as path from "path";

let { OPENAI_API_KEY } = process.env;
const OPENAI_MODEL_ENDPOINT =
  process.env.OPENAI_MODEL_ENDPOINT ||
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

// 🔥 NEW — MENU INSTRUCTIONS
const MENU_INSTRUCTIONS = `
Ти голосове меню компанії ДТЕК.

Визнач намір клієнта:
- meter — передати показники
- outage — відключення
- weather — погода

ПРАВИЛА:
- Привітайся
- Після першої фрази визнач намір
- НЕ пояснюй меню
- Одразу виклич switch_agent
- Якщо не зрозумів — уточни

Ти тільки маршрутизатор.
`;

// 🔥 NEW — MENU TOOLS
const MENU_TOOLS = [
  {
    type: "function",
    name: "switch_agent",
    description: "Switch dialog to another agent",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["meter", "outage", "weather"],
        },
      },
      required: ["agent"],
    },
  },
];

// 🔥 NEW — AGENT REGISTRY
const AGENTS: any = {
  meter: {
    instructions: DTEK_INSTRUCTIONS,
    tools: DTEK_TOOLS,
  },
  outage: {
    instructions: "Outage agent (TODO)",
    tools: [],
  },
  weather: {
    instructions: "Weather agent (TODO)",
    tools: [],
  },
};

export class OpenAIRealTime extends VoiceAIAgentBaseClass {
  private openAiWs: WebSocket;
  private isClosing: boolean = false;
  private userAddress: string = "";
  private tempAddressData: any = {};
  private fullTranscript: { role: string; content: string }[] = [];

  async sendKeepAlive(): Promise<void> {} // ✅ ПОВЕРНУЛИ

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

    this.openAiWs = new WebSocket(OPENAI_MODEL_ENDPOINT, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    this.openAiWs.on("open", () => {
      console.log(
        `[${new Date().toISOString()}] ✅ [OpenAI] З'єднання встановлено!`,
      );

      // ⚠️ CHANGED — СТАРТУЄМО З MENU
      const event = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: MENU_INSTRUCTIONS, // 🔥 було DTEK_INSTRUCTIONS
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
          tools: MENU_TOOLS, // 🔥 було DTEK_TOOLS
          tool_choice: "auto",
        },
      };

      // НАЛАШТУВАННЯ СЕСІЇ
      this.openAiWs.send(JSON.stringify(event));

      // 🔥 СКАЗАТИ БОТУ "ПОЧИНАЙ ГОВОРИТИ"
      this.openAiWs.send(
        JSON.stringify({
          type: "response.create",
        }),
      );
    });

    this.openAiWs.on("message", async (data: any) => {
      const messageString = Buffer.isBuffer(data) ? data.toString() : data;

      try {
        const response = JSON.parse(messageString);

        // AUDIO
        if (response.type === "response.output_audio.delta" && response.delta) {
          this.session.sendAudio(Buffer.from(response.delta, "base64"));
          return;
        }

        // SESSION OK
        if (response.type === "session.updated") {
          console.log("✨ session updated");
        }

        // BOT TEXT
        if (response.type === "response.output_audio_transcript.done") {
          this.fullTranscript.push({
            role: "assistant",
            content: response.transcript,
          });
          console.log("🤖 AI:", response.transcript);
        }

        // USER TEXT
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
          const output = response.response?.output || [];

          // 🔥 NEW — SWITCH AGENT
          const switchCall = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "switch_agent",
          );

          // 👉 ВСТАВЛЯЄТЬСЯ ПЕРЕД end_conversation
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
                  type: "realtime", // 🔥 FIX
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

            this.openAiWs.send(JSON.stringify({ type: "response.create" }));

            return;
          }

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
                this.session.sendDisconnect(
                  "completed" as any,
                  "AI session finished",
                  {
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
