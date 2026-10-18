// Locale-aware Link/redirect/usePathname/useRouter. Always import navigation from here, not next/*.
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
