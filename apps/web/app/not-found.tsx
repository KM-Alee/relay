// Requests that never reach a locale (e.g. a malformed path). Localized 404s: app/[locale]/not-found.tsx.
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main data-testid="not-found">404</main>
      </body>
    </html>
  );
}
