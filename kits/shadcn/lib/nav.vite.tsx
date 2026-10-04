// Navigation for Vite (React Router).
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router";
import type { ComponentProps } from "react";

export function useNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  return { path: pathname, go: (to: string) => navigate(to), param: (name: string) => search.get(name) };
}

export function Link({ to, ...props }: { to: string } & Omit<ComponentProps<"a">, "href">) {
  return <RouterLink to={to} {...props} />;
}
