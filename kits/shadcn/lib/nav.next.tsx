// @client
// Navigation for Next.js (App Router).
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

export function useNav() {
  const router = useRouter();
  const path = usePathname() ?? "/";
  const search = useSearchParams();
  return { path, go: (to: string) => router.push(to), param: (name: string) => search?.get(name) ?? null };
}

export function Link({ to, ...props }: { to: string } & Omit<ComponentProps<"a">, "href">) {
  return <NextLink href={to} {...props} />;
}
