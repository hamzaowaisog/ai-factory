import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names, the later Tailwind class winning a conflict. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
