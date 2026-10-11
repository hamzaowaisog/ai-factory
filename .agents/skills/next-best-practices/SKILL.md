---
name: next-best-practices
description: 'Next.js App Router best practices for the web products the factory builds (Next.js 15).'
---

# Next.js Best Practices

Rewritten for the factory from vercel-labs/next-skills `skills/next-best-practices`, as it stood
before Vercel retired the skill (commit dc1de9c, 2026-05-07). The published SKILL.md is an index
of reference files; the factory reads rule lists only, so the rules below are taken from those
reference files. Left out: anything the factory's kit decides (navigation, images, fonts, page
markup, where data is loaded), Next.js 16 features, metadata, parallel routes, self-hosting.

## Server and Client Components

- In a Next.js app, add 'use client' only to a file that uses React hooks, event handlers or browser APIs
- A component in a 'use client' file must not be an async function; load its data in an effect or in a parent Server Component and pass it down
- Props passed from a Server Component to a Client Component must be serializable: no functions (except Server Actions), Date objects, Map, Set or class instances
- Pass a date from a Server Component to a Client Component as an ISO string, not a Date object

## Async Request APIs

- In Next.js 15, type `params` and `searchParams` of a page, layout or route handler as a Promise and await them before use
- Await `cookies()` and `headers()` from next/headers before reading from them
- In a component that is not async, read `params` with `use(params)` from React

## Route Handlers

- Never put a route.ts and a page.tsx in the same folder; API routes live under app/api
- Return JSON from a route handler with `Response.json(body, { status })`, and set the status explicitly for anything other than 200
- A route handler cannot use React hooks, React DOM or browser APIs
- Use the default Node.js runtime; do not add `export const runtime = 'edge'` unless the project already uses it
- On Next.js 15 the request middleware file is middleware.ts; proxy.ts is Next.js 16 and later

## Error Handling

- An error.tsx file must be a Client Component, and a global-error.tsx must render its own html and body tags
- Never call `redirect()`, `permanentRedirect()` or `notFound()` inside a try block that catches everything: they work by throwing. Call them after the try/catch, or re-throw with `unstable_rethrow()` first in the catch

## Hydration

- Do not read `window`, `localStorage`, the current time or `Math.random()` while rendering a component the server also renders; set those values in useEffect
- Use `useId()` for generated element ids, never a random value
- Keep HTML nesting valid: no div or p element inside a p element
- Wrap a Client Component that calls `useSearchParams()` in a Suspense boundary

## Data and Bundling

- Start independent requests together with `Promise.all` instead of awaiting them one after another
- Import CSS files with an import statement, not a link tag
- A package that needs `window` or `document` is used only from a Client Component; where it breaks server rendering, load it with next/dynamic and `ssr: false`
