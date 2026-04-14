export const CONTRACT_TOOLS = [
  {
    type: "function",
    name: "switch_agent",
    description: "Перемикає діалог на потрібний сервіс",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["menu", "meter", "outage", "contract"],
        },
      },
      required: ["agent"],
    },
  },
  {
    type: "function",
    name: "end_conversation",
    description: "Завершити розмову.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["copmpleted", "operator"],
        },
      },
    },
  },
];
