import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
import { getNoInputTimeout } from "../common/environment-variables";

let { OPENAI_API_KEY } = process.env;
const OPENAI_MODEL_ENDPOINT =
  process.env.OPENAI_MODEL_ENDPOINT ||
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

export class OpenAIRealTime extends VoiceAIAgentBaseClass {
  private openAiWs: WebSocket;
  private isClosing: boolean = false;
  private userAddress: string = "";

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

    // 1. СПОЧАТКУ СТВОРЮЄМО
    this.openAiWs = new WebSocket(OPENAI_MODEL_ENDPOINT, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    this.openAiWs.on("open", () => {
      console.log(
        `[${new Date().toISOString()}] ✅ [OpenAI] З'єднання встановлено!`,
      );

      try {
        const event = {
          type: "session.update",
          session: {
            type: "realtime",
            instructions:
              "Ти помічник ДТЕК. Спілкуйся виключно українською мовою. Якщо клієнт хоче завершити розмову — виклич функцію end_conversation.",
            audio: {
              input: { format: { type: "audio/pcmu" } },
              output: { format: { type: "audio/pcmu" }, voice: "alloy" },
            },
            tools: [
              {
                type: "function",
                name: "end_conversation",
                description: "Завершити розмову та зберегти адресу клієнта.",
                parameters: {
                  type: "object",
                  properties: {
                    reason: { type: "string" },
                    address: {
                      type: "string",
                      description: "Повна адреса, яку назвав клієнт",
                    },
                  },
                },
              },
            ],
            tool_choice: "auto",
          },
        };

        console.log(
          `[${new Date().toISOString()}] 📝 [OpenAI] Надсилаю конфігурацію...`,
        );
        this.openAiWs.send(JSON.stringify(event));
      } catch (err) {
        console.error("❌ Помилка при формуванні JSON:", err);
      }
    });

    this.openAiWs.on("message", (data: any) => {
      // 1. Конвертуємо Buffer у рядок, щоб JSON міг його прочитати
      const messageString = Buffer.isBuffer(data) ? data.toString() : data;

      // Якщо хочеш бачити чистий текст у логах, розкоментуй наступний рядок:
      // console.log("RAW MESSAGE (TEXT):", messageString);

      try {
        const response = JSON.parse(messageString);

        // 2. ОБРОБКА ЗВУКУ (Аудіо-дельти)
        if (response.type === "response.output_audio.delta" && response.delta) {
          this.session.sendAudio(Buffer.from(response.delta, "base64"));
          return;
        }

        // 3. ПІДТВЕРДЖЕННЯ СЕСІЇ (той самий session.updated, про який я казав)
        if (response.type === "session.updated") {
          console.log(
            `[${new Date().toISOString()}] ✨ [OpenAI] Сесію успішно оновлено!`,
          );
        }

        // 4. ТЕКСТОВА ТРАНСКРИПЦІЯ
        if (response.type === "response.output_audio_transcript.done") {
          console.log(
            `[${new Date().toISOString()}] 🤖 AI: ${response.transcript}`,
          );
        }

        // // 5. ЛОГІКА ЗАВЕРШЕННЯ СЕСІЇ
        // if (response.type === "response.done") {
        //   const output = response.response?.output || [];
        //   const call = output.find(
        //     (item: any) =>
        //       item.type === "function_call" && item.name === "end_conversation",
        //   );

        //   if (call) {
        //     console.log(
        //       `[${new Date().toISOString()}] 🔚 Бот викликав функцію завершення розмови.`,
        //     );
        //     this.isClosing = true;

        //     this.openAiWs.send(
        //       JSON.stringify({
        //         type: "conversation.item.create",
        //         item: {
        //           type: "function_call_output",
        //           call_id: call.call_id,
        //           output: JSON.stringify({ status: "success" }),
        //         },
        //       }),
        //     );

        //     this.openAiWs.send(JSON.stringify({ type: "response.create" }));
        //   } else if (this.isClosing) {
        //     console.log(
        //       `[${new Date().toISOString()}] 🎤 Прощання завершено. Розриваємо потік і завершуємо Genesys...`,
        //     );

        //     // 1. Очищаємо таймер (global)
        //     if (this.noInputTimer) {
        //       global.clearTimeout(this.noInputTimer as any);
        //       this.noInputTimer = null;
        //     }

        //     try {
        //       // Використовуємо 'completed' замість 'session_completed'
        //       // Це найбільш стандартне значення для успішного завершення
        //       this.session.sendDisconnect(
        //         "completed",
        //         "AI agent finished the conversation",
        //         {},
        //       );
        //       console.log("✅ Команда sendDisconnect ('completed') надіслана");
        //     } catch (e) {
        //       console.log("⚠️ Помилка при виклику sendDisconnect:", e);
        //     }

        //     // 3. Чекаємо трохи, щоб Genesys обробив роз'єднання, і закриваємо сокет
        //     setTimeout(() => {
        //       this.session.close();
        //     }, 1000);
        //   }
        // }

        // 5. ЛОГІКА ЗАВЕРШЕННЯ СЕСІЇ
        if (response.type === "response.done") {
          const output = response.response?.output || [];
          const call = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "end_conversation",
          );

          if (call) {
            // 1. Парсимо аргументи функції
            const args = JSON.parse(call.arguments || "{}");
            if (args.address) {
              this.userAddress = args.address; // Зберігаємо адресу
              console.log(
                `[${new Date().toISOString()}] 🏠 Отримана адреса: ${this.userAddress}`,
              );
            }

            this.isClosing = true;

            // Підтверджуємо OpenAI (стандартно)
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

            this.openAiWs.send(JSON.stringify({ type: "response.create" }));
          } else if (this.isClosing) {
            console.log(
              `[${new Date().toISOString()}] 🎤 Прощання завершено. Передаємо дані в Genesys...`,
            );

            if (this.noInputTimer) {
              global.clearTimeout(this.noInputTimer as any);
              this.noInputTimer = null;
            }

            try {
              // 2. ПЕРЕДАЄМО АДРЕСУ В GENESYS
              // Третій параметр у sendDisconnect — це об'єкт outputVariables
              this.session.sendDisconnect(
                "completed" as any,
                "AI agent finished",
                { client_address: this.userAddress }, // Ця змінна з'явиться в Architect
              );
              console.log("✅ Дані з адресою надіслані в Genesys");
            } catch (e) {
              console.log("⚠️ Помилка sendDisconnect:", e);
            }

            setTimeout(() => {
              this.session.close();
            }, 1000);
          }
        }

        // 6. ПЕРЕВІРКА ПОМИЛОК
        if (response.type === "error") {
          console.error(
            "❌ OpenAI Error:",
            JSON.stringify(response.error, null, 2),
          );
        }
      } catch (err) {
        console.error("❌ Помилка обробки повідомлення:", err);
      }
    });
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

  protected isAgentConnected(): boolean {
    return this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN;
  }

  // Метод для зупинки поточної відповіді ШІ (наприклад, якщо клієнт перебив бота)
  cancelResponse() {
    if (this.isAgentConnected()) {
      console.log(
        `[${new Date().toISOString()}] 🛑 [OpenAI] Скасування відповіді (Barge-in)`,
      );
      this.openAiWs.send(JSON.stringify({ type: "response.cancel" }));
    }
  }

  // Метод для повного закриття з'єднання
  async close(): Promise<void> {
    if (this.openAiWs) {
      console.log(
        `[${new Date().toISOString()}] 🔌 [OpenAI] Закриття WebSocket з'єднання.`,
      );
      this.openAiWs.close();
    }
  }
}
