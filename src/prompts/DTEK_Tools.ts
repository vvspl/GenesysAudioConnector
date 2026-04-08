export const DTEK_TOOLS = [
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
      },
      required: ["full_address", "city", "street", "house"],
    },
  },
  {
    type: "function",
    name: "transferToAgent",
    description:
      "Переключити дзвінок на оператора, якщо виникла проблема або прямий запит клієнта.",
    parameters: {
      type: "object",
      properties: {
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        process: {
          type: "string",
          enum: [
            "MeterReading",
            "AddressIssue",
            "TechnicalError",
            "OtherRequest",
          ],
        },
      },
      required: ["process"],
    },
  },
];
