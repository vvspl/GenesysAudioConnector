export const MENU_TOOLS = [
  {
    type: "function",
    name: "switch_agent",
    description: "Перемикає діалог на потрібний сервіс",
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
