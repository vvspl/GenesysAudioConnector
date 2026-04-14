export const METER_TOOLS = [
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
          description: "Населений пункт",
        },
        street: {
          type: "string",
          description: "Вулиця або інша частина адреси",
        },
        house: {
          type: "string",
          description: "Номер будинку",
        },
        apartment: {
          type: "string",
          description: "Номер квартири",
        },
        reason: {
          type: "string",
          enum: ["completed", "operator"], // аргумент при завершенні діалогу
        },
      },
      required: ["full_address", "city", "street", "house"],
    },
  },
];
