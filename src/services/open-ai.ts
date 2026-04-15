import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
// import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
// import { getNoInputTimeout } from "../common/environment-variables";
import { MENU_INSTRUCTIONS } from "../prompts/Menu_Instructions";
import { MENU_TOOLS } from "../prompts/Menu_Tools";
import { AGENTS } from "../agents/agent-registry";

import * as fs from "fs";
import * as path from "path";

const { OPENAI_API_KEY, OPENAI_MODEL_ENDPOINT, NO_INPUT_TIMEOUT } = process.env;

// export class OpenAIRealTime extends VoiceAIAgentBaseClass {
export class OpenAIRealTime {
  private openAiWs: WebSocket;
  private tempAddressData: any = {};
  private fullTranscript: { role: string; content: string }[] = [];
  private hasStarted = false; // признак початку сесії
  private lastUserMessageValid = false; // прийняти репліку клієнта (для відсікання коротких звуків і тиші)
  private noInputTimer: NodeJS.Timeout | null = null;
  private session: Session;
  private isUserSpeaking = false;
  private userSpeechTimeout: NodeJS.Timeout | null = null;

  // async sendKeepAlive(): Promise<void> {}

  constructor(session: Session) {
    this.session = session;
    console.log(`🔌 [OpenAI] Спроба підключення до: ${OPENAI_MODEL_ENDPOINT}`);

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

    this.bindWsEvents(); /// 🔥 винесли логіку в метод
  }

  private bindWsEvents() {
    // відправляємо голос
    this.openAiWs.on("message", async (data: any) => {
      console.log("🔥 message RECEIVED");
      const messageString = Buffer.isBuffer(data) ? data.toString() : data;

      try {
        const response = JSON.parse(messageString);

        console.log("🔥 response.type:", response.type);

        if (response.type === "response.created") {
          console.log("🤖 бот почав відповідь → стоп таймер");
          this.clearNoInputTimer();
        }

        // бот вже говорить → стоп таймер
        if (response.type === "response.output_audio.delta") {
          this.clearNoInputTimer();
        }

        // Відловлюємо тишу - скидаємо запущений таймер коли клієнт почав говорити
        if (response.type === "input_audio_buffer.speech_started") {
          console.log("🎤 клієнт почав говорити → скидаємо таймер");
          this.isUserSpeaking = true;

          if (this.userSpeechTimeout) {
            clearTimeout(this.userSpeechTimeout);
            this.userSpeechTimeout = null;
            console.log("🛑 юзер продовжив говорити → не відповідаємо");
          }
          this.clearNoInputTimer();
        }

        if (response.type === "input_audio_buffer.speech_stopped") {
          this.isUserSpeaking = false;
          //  чекаємо після закінчення слів клієнта перед реакцією
          if (this.userSpeechTimeout) {
            clearTimeout(this.userSpeechTimeout);
          }

          this.userSpeechTimeout = setTimeout(() => {
            // якщо юзер знову почав говорити — вихід
            if (this.isUserSpeaking) {
              console.log("⛔ юзер знову говорить — не відповідаємо");
              return;
            }
            // якщо нема валідного тексту — НЕ відповідаємо
            if (!this.lastUserMessageValid) {
              console.log("🚫 нема валідного input — не відповідаємо");
              return;
            }

            console.log("⏳ юзер точно закінчив → можна відповідати");
            this.openAiWs.send(
              JSON.stringify({
                type: "response.create",
              }),
            );
            // скидаємо флаг ПІСЛЯ запуску
            this.lastUserMessageValid = false;
            console.log("🔄 reset lastUserMessageValid (after speech)");
          }, 2000);
        }

        // AUDIO
        if (response.type === "response.output_audio.delta" && response.delta) {
          console.log("🔥 audio chunk RECEIVED");

          this.session.sendAudio(Buffer.from(response.delta, "base64"));
          return;
        }

        // Відловлюємо тишу: коли бот закінчив фразу - запускаємо таймер тиші
        if (response.type === "response.output_audio.done") {
          if (!this.lastUserMessageValid) {
            console.log("🚫 не запускаємо таймер — не було user input");
            return;
          }
          console.log("🔊 бот договорив → запускаємо таймер тиші");
          this.startNoInputTimer();
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
          if (!userText || userText.length < 3) {
            console.log("⚠️ пустий або шум, ігноруємо");
            this.lastUserMessageValid = false; // скидаємо старе значення
            console.log("🔄 reset lastUserMessageValid");
            return;
          }
          this.clearNoInputTimer(); // Очищуємо таймер тиші
          this.lastUserMessageValid = true;

          if (userText) {
            this.fullTranscript.push({ role: "user", content: userText });
            console.log("👤 Клієнт:", userText);
            // this.lastUserMessageValid = true;
            console.log("✅ lastUserMessageValid = true");
          }
        }

        // =============================
        // 🔥 ОСНОВНА ЛОГІКА
        // =============================

        // пропускаємо тільки якщо це реально відповідь на юзера

        if (response.type === "response.done") {
          console.log("🔥 response.done RECEIVED");

          const output = response.response?.output || [];

          /// 🔥 перевіряємо чи це assistant message
          const hasAssistantMessage = output.some(
            (item: any) => item.type === "message",
          );

          // if (!this.lastUserMessageValid && hasAssistantMessage) {
          //   console.log("⛔ пропускаємо відповідь — не було валідного input");
          //   return;
          // }

          if (this.lastUserMessageValid) {
            this.lastUserMessageValid = false;
            console.log("🔄 reset lastUserMessageValid (after real response)");
          }

          // if (this.lastUserMessageValid) {
          //   this.lastUserMessageValid = false;
          //   console.log("🔄 reset lastUserMessageValid (after real response)");
          // }

          // // this.lastUserMessageValid = false; // Скидання флага
          // console.log("🔄 reset lastUserMessageValid");
          // const output = response.response?.output || [];
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

            // Записуємо дані і перериваємо діалог
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

  // отримує аудіо від Genesys відправляє його в OpenAI
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

  // функція для перебивання бота
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

  // Функція збереження транскрибування в файл і повертає посилання на нього
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

  // Функція керування тишею
  private startNoInputTimer() {
    this.clearNoInputTimer();

    const timeout = Number(NO_INPUT_TIMEOUT) || 8000;
    console.log("⏱️ NO_INPUT_TIMEOUT =", timeout);

    this.noInputTimer = setTimeout(() => {
      if (!this.lastUserMessageValid) {
        console.log("🚫 таймер спрацював, але user не говорив — ігноруємо");
        return;
      }
      console.log("🕒 клієнт мовчить → реакція");

      if (this.isUserSpeaking) {
        console.log("⛔ користувач говорить — не тригеримо");
        return;
      }

      if (this.lastUserMessageValid) {
        console.log("⛔ НЕ запускаємо no-input — був валідний інпут");
        return;
      }

      if (!this.hasStarted && this.lastUserMessageValid)
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
