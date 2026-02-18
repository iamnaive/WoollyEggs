export const BASE_ADDRESSES: string[] = [
  // Paste base allowlist addresses here, one per string.
  // Example: "0x1234567890abcdef1234567890abcdef12345678"
];

export const BASE_SET = new Set(BASE_ADDRESSES.map((a) => a.trim().toLowerCase()));
