import { VapidWebPushSender, type WebPushSender } from "@medpass/notifications";
import { env } from "./env";

let sender: WebPushSender | null | undefined;

/** Returns null when push isn't configured (dev without VAPID keys set). */
export function getWebPushSender(): WebPushSender | null {
  if (sender === undefined) {
    const config = env();
    sender =
      config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
        ? new VapidWebPushSender({
            publicKey: config.VAPID_PUBLIC_KEY,
            privateKey: config.VAPID_PRIVATE_KEY,
            subject: config.VAPID_SUBJECT,
          })
        : null;
  }
  return sender;
}
