// @client
import { Toaster as Sonner } from "sonner";

/** Where the short messages after an action appear (one per app, in the frame). */
export function Toaster() {
  return <Sonner position="bottom-right" richColors closeButton toastOptions={{ classNames: { toast: "font-body" } }} />;
}
