import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { Session } from "../websocket/session";
import { VoiceAIAgentBaseClass } from "./voice-aiagent-base";
import { getNoInputTimeout } from "../common/environment-variables";

import * as fs from "fs";
import * as path from "path";

let { OPENAI_API_KEY } = process.env;
const OPENAI_MODEL_ENDPOINT =
  process.env.OPENAI_MODEL_ENDPOINT ||
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

export class OpenAIRealTime extends VoiceAIAgentBaseClass {
  private openAiWs: WebSocket;
  private isClosing: boolean = false;
  private userAddress: string = "";
  private tempAddressData: any = {};
  private fullTranscript: { role: string; content: string }[] = [];

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
            instructions: `
Ти помічник ДТЕК. Твоя місія - приймати дзвінки абонентів які хочуть передати показник лічильника електроенергії за вказаною повною адресою.
Тобі потрібно першим привітатися на початку діалогу і далі запитати чи бажає клієнт передати показники лічильника. Якщо так - запитати повну адресу.
Після того як клієнт каже повну адресу - обов'язково перепитати чи вірно вказана адреса: повторити її клієнту. Якщо відповідь ствердна - в такому самому стилі запитати показник лічильника.
Якщо клієнт каже що адреса не правильна - то уточнити її повторно.
Якщо клієнт хоче будь що інше окрім передачі показань лічильника - запропонувати зателефонувати на гарячу лінію і ввічливо завершити сесію діалога (виклик end_conversation).

ВАЖЛИВО:
- Клієнт може говорити українською, російською або змішаною мовою.
- Завжди інтерпретуй сказане як українську.
- Нормалізуй слова до української мови.
- Якщо адреса сказана різними мовами — об'єднуй її в одну українську адресу.
- Числа розпізнавай навіть якщо вони сказані іншою мовою.

Спілкуйся виключно українською.
Якщо клієнт хоче завершити розмову — виклич end_conversation.
`,
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
            tools: [
              {
                type: "function",
                name: "end_conversation",
                description: "Завершити розмову та зберегти всі дані клієнта.",
                parameters: {
                  type: "object",
                  properties: {
                    full_address: {
                      type: "string",
                      description: "Повна адреса одним рядком",
                    },
                    city: {
                      type: "string",
                      description:
                        "Населений пункт: місто, село, селище, смт тощо.",
                    },
                    street: {
                      type: "string",
                      description:
                        "Все, що не є населеним пунктом: вулиця, площа, провулок, мікрорайон, військове містечко, квартал тощо.",
                    },
                    house: { type: "string", description: "Номер будинку" },
                    apartment: {
                      type: "string",
                      description: "Номер квартири",
                    },
                  },
                  required: ["full_address", "city", "street", "house"],
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

    this.openAiWs.on("message", async (data: any) => {
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
          // Коли бот договорив фразу - додаємо її в запис діалогу
          this.fullTranscript.push({
            role: "assistant",
            content: response.transcript,
          });
          console.log(
            `[${new Date().toISOString()}] 🤖 AI: ${response.transcript}`,
          );
        }

        // Коли клієнт закінчив фразу (OpenAI Realtime надсилає транскрипт користувача)
        // додаємо фразу кліэнта в запис діалогу
        if (
          response.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          const userText = response.transcript?.trim();
          if (userText) {
            this.fullTranscript.push({ role: "user", content: userText });
            console.log(`[${new Date().toISOString()}] 👤 Клієнт: ${userText}`);
          }
        }

        // 5. ЛОГІКА ЗАВЕРШЕННЯ СЕСІЇ
        if (response.type === "response.done") {
          const output = response.response?.output || [];
          const call = output.find(
            (item: any) =>
              item.type === "function_call" && item.name === "end_conversation",
          );

          if (call) {
            const args = JSON.parse(call.arguments || "{}");

            // Зберігаємо всі дані в об'єкт
            this.tempAddressData = {
              full_address: args.full_address || "",
              city: args.city || "",
              street: args.street || "",
              house: args.house || "",
              apartment: args.apartment || "",
            };

            console.log(
              `[${new Date().toISOString()}] 🏠 Зібрано дані для Genesys:`,
              this.tempAddressData,
            );
            this.isClosing = true;

            // Підтверджуємо OpenAI виконання функції
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
            if (this.noInputTimer) {
              global.clearTimeout(this.noInputTimer as any);
              this.noInputTimer = null;
            }

            const conversationId =
              (this.session as any).conversationId || "unknown";

            // 1. Чекаємо на генерацію посилання
            const transcriptUrl =
              await this.saveTranscriptAndGetUrl(conversationId);

            try {
              // 2. Відправляємо посилання в Genesys Architect
              this.session.sendDisconnect(
                "completed" as any,
                "AI session finished",
                {
                  full_address: this.tempAddressData.full_address,
                  city: this.tempAddressData.city,
                  street: this.tempAddressData.street,
                  house: this.tempAddressData.house,
                  apartment: this.tempAddressData.apartment,
                  // ТЕПЕР ТУТ БУДЕ ПОСИЛАННЯ
                  conversation_history: transcriptUrl,
                },
              );
              console.log(
                `✅ Посилання на лог відправлено в Genesys: ${transcriptUrl}`,
              );
            } catch (e) {
              console.error("⚠️ Помилка передачі:", e);
            }

            setTimeout(() => this.session.close(), 1000);
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

  // Метод для запису conversation в файл і формування посилання на нього
  private async saveTranscriptAndGetUrl(
    conversationId: string,
  ): Promise<string> {
    try {
      // Шлях до папки (відносно файлу open-ai.ts)
      const logDir = path.join(__dirname, "../../public/logs");

      // Створюємо папку, якщо її немає
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const fileName = `${conversationId}.txt`;
      const filePath = path.join(logDir, fileName);

      const chatText = this.fullTranscript
        .map((t) => `${t.role === "user" ? "Клієнт" : "Бот"}: ${t.content}`)
        .join("\n");

      // Записуємо повний текст у файл
      fs.writeFileSync(filePath, chatText, "utf8");

      // Формуємо посилання.
      const baseUrl = process.env.NGROK_STATIC_URL;
      return `${baseUrl}/logs/${fileName}`;
    } catch (err) {
      console.error("❌ Помилка збереження файлу:", err);
      return "Помилка збереження логу";
    }
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
