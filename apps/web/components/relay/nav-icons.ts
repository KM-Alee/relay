// Maps `NavItem.icon` names (nav.ts) to lucide components. Unknown names fall back to a dot.
import {
  Calendar,
  Circle,
  Contact,
  CreditCard,
  Gavel,
  Inbox,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MessageCircle,
  Plug,
  ScrollText,
  Settings,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'inbox-arrow': Inbox,
  'message-circle': MessageCircle,
  kanban: Kanban,
  'life-buoy': LifeBuoy,
  workflow: Workflow,
  calendar: Calendar,
  'credit-card': CreditCard,
  users: Users,
  plug: Plug,
  'scroll-text': ScrollText,
  settings: Settings,
  gavel: Gavel,
  contact: Contact,
  user: User,
  'list-checks': ListChecks,
};

export const navIcon = (name: string): LucideIcon => ICONS[name] ?? Circle;
