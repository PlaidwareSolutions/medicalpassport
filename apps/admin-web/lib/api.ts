"use client";
import { ApiClient } from "@medpass/api-client";

export const api = new ApiClient({
  baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1`,
});

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
