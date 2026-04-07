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

    // 2. ПОТІМ ПРИЗНАЧАЄМО ОБРОБНИКИ
    this.openAiWs.on("open", () => {
      console.log(
        `[${new Date().toISOString()}] ✅ [OpenAI] З'єднання встановлено!`,
      );

      const event = {
        type: "session.update",
        session: {
          type: "realtime",
          instructions:
            "Ти помічник ДТЕК. Спілкуйся виключно українською мовою.",
          audio: {
            input: {
              format: {
                type: "audio/pcmu",
              },
            },
            output: {
              format: {
                type: "audio/pcmu",
              },
              voice: "alloy",
            },
          },
        },
      };

      console.log(
        `[${new Date().toISOString()}] 📝 [OpenAI] Надсилаю конфігурацію...`,
      );
      this.openAiWs.send(JSON.stringify(event));
    });

    this.openAiWs.on("message", (data: string) => {
      try {
        const response = JSON.parse(data);

        // 1. Ловимо звук (дельти)
        if (response.type === "response.output_audio.delta") {
          if (response.delta) {
            // Конвертуємо Base64 назад у бінарні дані та шлемо в Genesys
            const audioBuffer = Buffer.from(response.delta, "base64");
            this.session.sendAudio(new Uint8Array(audioBuffer));
          }
        }

        // 2. Ловимо текст для консолі (щоб бачити, що каже бот)
        if (response.type === "response.output_audio_transcript.delta") {
          // Можна додавати в один рядок для красивого виводу
          process.stdout.write(response.delta);
        }

        // 3. Завершення відповіді
        if (response.type === "response.output_audio_transcript.done") {
          console.log(
            `\n[${new Date().toISOString()}] 🤖 AI DONE: ${response.transcript}`,
          );
        }

        if (response.type === "error") {
          console.error("❌ OpenAI API Error:", response.error);
        }
      } catch (e) {
        console.error("❌ Помилка обробки повідомлення OpenAI:", e);
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
