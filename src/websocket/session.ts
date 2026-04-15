import { v4 as uuid } from "uuid";
import { WebSocket } from "ws";
import { JsonStringMap, MediaParameter } from "../protocol/core";
import {
  EventEntityDataTranscript,
  EventEntityTranscript,
} from "../protocol/entities-transcript";
import {
  ClientMessage,
  DisconnectParameters,
  DisconnectReason,
  EventParameters,
  SelectParametersForType,
  ServerMessage,
  ServerMessageBase,
  ServerMessageType,
} from "../protocol/message";
import {
  BotTurnDisposition,
  EventEntityBargeIn,
  EventEntityBotTurnResponse,
} from "../protocol/voice-bots";
import { MessageHandlerRegistry } from "./message-handlers/message-handler-registry";

import { DTMFService } from "../services/dtmf-service";
// import { VoiceAIAgentBaseClass } from "../services/voice-aiagent-base";
import { OpenAIRealTime } from "../services/open-ai"; /// 🔥
import { VoiceAIAgentFactory } from "../services/voice-aiagent-factory";
import {
  getMAXBinaryMessageSize,
  getMinBinaryMessageSize,
} from "../common/environment-variables";
import { AudioPacedSender } from "./audio-pacer";

const BOT_PROVIDER = process.env.BOT_PROVIDER || "openai"; // Default to OpenAI if not specified

export class Session {
  private MAXIMUM_BINARY_MESSAGE_SIZE = getMAXBinaryMessageSize();
  private MIN_BINARY_MESSAGE_SIZE = getMinBinaryMessageSize();
  private disconnecting = false;
  private closed = false;
  private ws;

  private messageHandlerRegistry = new MessageHandlerRegistry();

  private dtmfService: DTMFService | null = null;
  // private voiceAIAgentClient:VoiceAIAgentBaseClass | null=null;
  private voiceAIAgentClient: OpenAIRealTime | null = null;

  private url;
  private clientSessionId;
  private conversationId: string | undefined;
  private lastServerSequenceNumber = 0;
  private lastClientSequenceNumber = 0;
  private inputVariables: JsonStringMap = {};
  private selectedMedia: MediaParameter | undefined;

  private isCapturingDTMF = false;
  private isAudioPlaying = false;
  private buffer: Array<Uint8Array> = new Array<Uint8Array>();
  private paced: AudioPacedSender;

  constructor(ws: WebSocket, sessionId: string, url: string) {
    this.ws = ws;
    this.clientSessionId = sessionId;
    this.url = url;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session]Created a new Session with ID: ${this.clientSessionId}.`,
    );
    // this.voiceAIAgentClient = VoiceAIAgentFactory.create(BOT_PROVIDER, this);
    this.voiceAIAgentClient = new OpenAIRealTime(this); /// 🔥
    this.paced = new AudioPacedSender(ws, 8000, 2, 2, 250);
  }
  getClientSessionId() {
    return this.clientSessionId;
  }
  getIsAudioPlaying() {
    return this.isAudioPlaying;
  }

  close() {
    if (this.closed) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] WebSocket connection already Closed`,
      );
      return;
    }
    try {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session]Closing the WebSocket connection.`,
      );
      this.ws.close();
      this.voiceAIAgentClient?.close();
    } catch (e) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Error while closing WebSocket: ${e}`,
      );
    }
    this.closed = true;
    console.log(
      new Date().toISOString() + ":" + `[Session] Session marked as closed.`,
    );
  }

  setConversationId(conversationId: string) {
    this.conversationId = conversationId;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Conversation ID set: ${conversationId}`,
    );
  }

  setInputVariables(inputVariables: JsonStringMap) {
    this.inputVariables = inputVariables;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Input variables set: ${JSON.stringify(inputVariables)}`,
    );
  }
  getInputVariables() {
    return this.inputVariables;
  }

  setSelectedMedia(selectedMedia: MediaParameter) {
    this.selectedMedia = selectedMedia;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Selected media set: ${JSON.stringify(selectedMedia)}`,
    );
  }

  playbackCompleted() {
    console.log(new Date().toISOString() + ":" + `[Session]Playback Completed`);
    this.setIsAudioPlaying(false);
    // this.voiceAIAgentClient?.processPlaybackCompleted();
  }
  setIsAudioPlaying(isAudioPlaying: boolean) {
    this.isAudioPlaying = isAudioPlaying;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] isAudioPlaying set to: ${isAudioPlaying}`,
    );
  }
  processTextMessage(data: string) {
    if (this.closed) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Ignoring text message: session is closed.`,
      );
      return;
    }

    const message = JSON.parse(data);
    if (message["type"] == "error" && message["parameters"]) {
      console.log(
        new Date().toISOString() + ":" + "[Session]Received Error Message",
      );
    }

    if (message.seq !== this.lastClientSequenceNumber + 1) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session]Invalid client sequence number: ${message.seq}.`,
      );
      this.sendDisconnect("error", "Invalid client sequence number.", {});
      return;
    }

    this.lastClientSequenceNumber = message.seq;

    if (message.serverseq > this.lastServerSequenceNumber) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session]Invalid server sequence number: ${message.serverseq}.`,
      );
      this.sendDisconnect("error", "Invalid server sequence number.", {});
      return;
    }

    if (message.id !== this.clientSessionId) {
      console.log(
        new Date().toISOString() +
          ":" +
          `Invalid Client Session ID: ${message.id}.`,
      );
      this.sendDisconnect("error", "Invalid ID specified.", {});
      return;
    }
    console.log(
      new Date().toISOString() +
        ":" +
        `Received a message of type '${message.type}' with parameters: ${JSON.stringify(message.parameters)}`,
    );
    const handler = this.messageHandlerRegistry.getHandler(message.type);

    if (!handler) {
      console.log(
        new Date().toISOString() +
          ":" +
          `Cannot find a message handler for '${message.type}'.`,
      );
      return;
    }
    handler.handleMessage(message as ClientMessage, this);
  }

  createMessage<Type extends ServerMessageType, Message extends ServerMessage>(
    type: Type,
    parameters: SelectParametersForType<Type, Message>,
  ): ServerMessage {
    const message: ServerMessageBase<Type, typeof parameters> = {
      id: this.clientSessionId as string,
      version: "2",
      seq: ++this.lastServerSequenceNumber,
      clientseq: this.lastClientSequenceNumber,
      type,
      parameters,
    };
    return message as ServerMessage;
  }

  send(message: ServerMessage) {
    if (message.type === "event") {
      console.log(
        new Date().toISOString() +
          ":" +
          `Sending an ${message.type} message: ${message.parameters.entities[0].type}.`,
      );
    } else {
      console.log(
        new Date().toISOString() + ":" + `Sending a ${message.type} message.`,
      );
    }
    this.ws.send(JSON.stringify(message));
  }

  flushBuffer() {
    const totalLength =
      this.buffer?.reduce((acc, curr) => acc + curr.length, 0) || 0;
    if (totalLength <= 0) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] flushBuffer called but buffer is empty.`,
      );
      return;
    }
    const bytes = new Uint8Array(totalLength);
    // Copy each array into the combined array
    let offset = 0;
    for (const byteArray of this.buffer) {
      bytes.set(byteArray, offset);
      offset += byteArray.length;
    }
    this.buffer.length = 0;

    if (bytes.length <= this.MAXIMUM_BINARY_MESSAGE_SIZE) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Sending ${bytes.length} binary bytes in 1 message.`,
      );
      this.ws.send(bytes, { binary: true });
    } else {
      let currentPosition = 0;
      while (currentPosition < bytes.length) {
        const sendBytes = bytes.slice(
          currentPosition,
          currentPosition + this.MAXIMUM_BINARY_MESSAGE_SIZE,
        );
        console.log(
          new Date().toISOString() +
            ":" +
            `[Session] Sending ${sendBytes.length} binary bytes in chunked message.`,
        );
        this.ws.send(sendBytes, { binary: true });
        currentPosition += this.MAXIMUM_BINARY_MESSAGE_SIZE;
      }
    }
  }

  sendAudio(currBytes: Uint8Array) {
    this.paced.enqueue(currBytes);
  }

  sendAudioLegacy(currBytes: Uint8Array) {
    //console.log(new Date().toISOString()+':'+`Sending ${currBytes.length/1000}KB of Audio to Genesys.`);
    this.buffer.push(currBytes);
    const totalLength =
      this.buffer?.reduce((acc, curr) => acc + curr.length, 0) || 0;
    if (totalLength < this.MIN_BINARY_MESSAGE_SIZE) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Buffer size (${totalLength}) less than minimum, delaying send.`,
      );
      setTimeout(this.flushBuffer.bind(this), 500);
      return;
    }

    const bytes = new Uint8Array(totalLength);

    // Copy each array into the combined array
    let offset = 0;
    for (const byteArray of this.buffer) {
      bytes.set(byteArray, offset);
      offset += byteArray.length;
    }
    this.buffer.length = 0;

    if (bytes.length <= this.MAXIMUM_BINARY_MESSAGE_SIZE) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Sending ${bytes.length} binary bytes in 1 message.`,
      );
      this.ws.send(bytes, { binary: true });
    } else {
      let currentPosition = 0;

      while (currentPosition < bytes.length) {
        const sendBytes = bytes.slice(
          currentPosition,
          currentPosition + this.MAXIMUM_BINARY_MESSAGE_SIZE,
        );
        console.log(
          new Date().toISOString() +
            ":" +
            `[Session] Sending ${sendBytes.length} binary bytes in chunked message.`,
        );
        this.ws.send(sendBytes, { binary: true });
        currentPosition += this.MAXIMUM_BINARY_MESSAGE_SIZE;
      }
    }
  }

  sendBargeIn() {
    const bargeInEvent: EventEntityBargeIn = {
      type: "barge_in",
      data: {},
    };
    const message = this.createMessage("event", {
      entities: [bargeInEvent],
    } as SelectParametersForType<"event", EventParameters>);
    this.buffer.length = 0;
    this.paced.flushAll();
    console.log(
      new Date().toISOString() + ":" + `[Session] Sending barge-in event.`,
    );
    this.send(message);
  }

  sendTurnResponse(
    disposition: BotTurnDisposition,
    text: string | undefined,
    confidence: number | undefined,
  ) {
    const botTurnResponseEvent: EventEntityBotTurnResponse = {
      type: "bot_turn_response",
      data: {
        disposition,
        text,
        confidence,
      },
    };
    const message = this.createMessage("event", {
      entities: [botTurnResponseEvent],
    } as SelectParametersForType<"event", EventParameters>);

    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Sending bot turn response: disposition=${disposition}, text=${text}, confidence=${confidence}`,
    );
    this.send(message);
  }

  sendTranscript(transcript: string, confidence: number, isFinal: boolean) {
    const channel = this.selectedMedia?.channels[0];

    if (channel) {
      const parameters: EventEntityDataTranscript = {
        id: uuid(),
        channel,
        isFinal,
        alternatives: [
          {
            confidence,
            interpretations: [
              {
                type: "normalized",
                transcript,
              },
            ],
          },
        ],
      };
      const transcriptEvent: EventEntityTranscript = {
        type: "transcript",
        data: parameters,
      };
      const message = this.createMessage("event", {
        entities: [transcriptEvent],
      } as SelectParametersForType<"event", EventParameters>);

      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Sending transcript: ${transcript}, confidence=${confidence}, isFinal=${isFinal}`,
      );
      this.send(message);
    }
  }

  sendDisconnect(
    reason: DisconnectReason,
    info: string,
    outputVariables: JsonStringMap,
  ) {
    this.disconnecting = true;
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Sending disconnect: reason=${reason}, info=${info}`,
    );
    const disconnectParameters: DisconnectParameters = {
      reason,
      info,
      outputVariables,
    };
    const message = this.createMessage("disconnect", disconnectParameters);

    this.send(message);
  }

  sendClosed() {
    const message = this.createMessage("closed", {});
    console.log(
      new Date().toISOString() + ":" + `[Session] Sending closed message.`,
    );
    this.send(message);
  }
  sendKeepAlive() {
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Sending keep-alive (pong) message.`,
    );
    this.send(this.createMessage("pong", {}));
    // this.voiceAIAgentClient?.sendKeepAlive();
  }

  /*
   * This method is used to process the incoming audio data from the Client.
   * This part has a "dummy" implementation that will need to be replaced
   * with a proper ASR engine.
   *
   * See `asr-service` in the `services` folder for more information.
   */
  processBinaryMessage(data: Uint8Array) {
    if (this.disconnecting || this.closed) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Ignoring binary message: session disconnecting or closed.`,
      );
      return;
    }
    // Ignore audio if we are capturing DTMF
    if (this.isCapturingDTMF) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Ignoring binary message: capturing DTMF.`,
      );
      return;
    }
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Processing binary audio message of length ${data.length}.`,
    );
    this.voiceAIAgentClient?.processAudio(data);
  }
  /*
   * This method is used to process the incoming DTMF digits from the Client.
   * This part has a "dummy" implementation that will need to be replaced
   * with proper logic.
   *
   * See `dtmf-service` in the `services` folder for more information.
   */
  processDTMF(digit: string) {
    if (this.disconnecting || this.closed) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Ignoring DTMF: session disconnecting or closed.`,
      );
      return;
    }
    /*
     * For this implementation, we are going to ignore input while there
     * is audio playing. You may choose to continue to process DTMF if
     * you want to enable support for Barge-In scenarios.
     */
    if (this.isAudioPlaying) {
      console.log(
        new Date().toISOString() +
          ":" +
          `[Session] Ignoring DTMF: audio is playing.`,
      );
      this.dtmfService = null;
      return;
    }
    // If we are capturing DTMF, flag it so we stop capturing audio,
    // and close down the audio capturing.
    if (!this.isCapturingDTMF) {
      this.isCapturingDTMF = true;
      console.log(
        new Date().toISOString() + ":" + `[Session] Started capturing DTMF.`,
      );
    }
    if (!this.dtmfService || this.dtmfService.getState() === "Complete") {
      this.dtmfService = new DTMFService()
        .on("error", (error: any) => {
          const message = "Error during DTMF Capture.";
          console.log(new Date().toISOString() + ":" + `${message}: ${error}`);
          this.sendDisconnect("error", message, {});
        })
        .on("final-digits", (digits) => {
          this.sendTranscript(digits, 1.0, true);
          console.log(
            new Date().toISOString() +
              ":" +
              `Captured DTMF Digits: ${digits}|To Be Implemented further`,
          );
          this.isCapturingDTMF = false;
        });
      console.log(
        new Date().toISOString() + ":" + `[Session] DTMFService initialized.`,
      );
    }
    console.log(
      new Date().toISOString() +
        ":" +
        `[Session] Processing DTMF digit: ${digit}`,
    );
    this.dtmfService.processDigit(digit);
  }
}
