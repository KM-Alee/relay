// Unknown localized paths → the localized not-found page.
import { notFound } from 'next/navigation';

export default function CatchAll() {
  notFound();
}
