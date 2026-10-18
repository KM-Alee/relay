'use client';
// Kitchen sink: every shared component in every state (docs/design/components.md header). Dev only.
// Toggle locale (en/ur) and theme (light/dark/system) in the toolbar; agents verify visuals here.
import {
  ArrowUpRight,
  Clock3,
  Inbox,
  Phone,
  Plus,
  TriangleAlert,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { AIBadge } from '@/components/relay/ai-badge';
import { AlertChip } from '@/components/relay/alert-chip';
import { AvailabilitySwitcher } from '@/components/relay/availability-switcher';
import { ChartCard } from '@/components/relay/chart-card';
import { ConfirmDialog } from '@/components/relay/confirm-dialog';
import { CountdownRing } from '@/components/relay/countdown-ring';
import { DataTable, type Column, type SortState } from '@/components/relay/data-table';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/relay/drawer';
import { EmptyState } from '@/components/relay/empty-state';
import { FormField } from '@/components/relay/form-field';
import { GlassArt } from '@/components/relay/glass-art';
import { KpiTile } from '@/components/relay/kpi-tile';
import { LocaleSwitcher } from '@/components/relay/locale-switcher';
import { Ltr } from '@/components/relay/ltr';
import { MaskedValue } from '@/components/relay/masked-value';
import { NotificationsPanel, type NotificationItem } from '@/components/relay/notifications-panel';
import { OwnerChip, type Availability } from '@/components/relay/owner-chip';
import { PageHeader } from '@/components/relay/page-header';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { StatusBadge } from '@/components/relay/status-badge';
import { ThemeSwitcher } from '@/components/relay/theme-switcher';
import { TimeWarpBadge } from '@/components/relay/time-warp-badge';
import { TopNav } from '@/components/relay/top-nav';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/lib/format/use-format';
import { visibleNav } from '@/nav';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';

const NOW = Date.parse('2026-10-18T09:00:00Z');
const WINDOW = 120_000;
const ends = (secondsLeft: number) => NOW + secondsLeft * 1000;

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  owner: string;
  state: 'waiting' | 'acked' | 'overdue';
  value: number | null;
}
const ROWS: LeadRow[] = [
  {
    id: '1',
    name: 'Hamza Ali',
    phone: '+92 300 1234567',
    owner: 'Sara Khan',
    state: 'waiting',
    value: 2_500_000,
  },
  {
    id: '2',
    name: 'Ayesha Malik',
    phone: '+92 321 7654321',
    owner: 'Bilal Ahmed',
    state: 'acked',
    value: null,
  },
  {
    id: '3',
    name: 'Usman Raza',
    phone: '+92 333 5550101',
    owner: 'Sara Khan',
    state: 'overdue',
    value: 840_000,
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`ks-${id}`} className="space-y-4">
      <h2 id={`ks-${id}`} className="text-page text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ name, cls }: { name: string; cls: string }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className={`size-9 shrink-0 rounded-control border border-line ${cls}`} />
      <code dir="ltr" className="text-meta text-fg-2">
        {name}
      </code>
    </li>
  );
}

export function KitchenSink() {
  const t = useTranslations('common');
  const k = (key: string, values?: Record<string, string | number>) => t(`dev.kitchen.${key}`, values);
  const f = useFormat();
  const locale = useLocale();
  const [availability, setAvailability] = useState<Availability>('available');
  const [sort, setSort] = useState<SortState>({ id: 'name', dir: 'asc' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [liveEnds] = useState(() => Date.now() + 95_000);
  const [loadingBtn, setLoadingBtn] = useState(false);

  const navItems = useMemo(() => visibleNav(new Set(PERMISSION_KEYS), { isOwner: true, demoMode: true }), []);
  const sorted = useMemo(
    () => [...ROWS].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * a.name.localeCompare(b.name)),
    [sort],
  );
  const notifications: NotificationItem[] = [
    { id: 'n1', kind: 'escalation', title: k('sample.escalation'), ownerName: 'Bilal Ahmed', href: '/leads' },
    {
      id: 'n2',
      kind: 'ack',
      title: k('sample.pending'),
      ownerName: 'Sara Khan',
      endsAt: new Date(ends(45)).toISOString(),
      windowMs: WINDOW,
      href: '/leads',
    },
  ];

  const columns: Column<LeadRow>[] = [
    {
      id: 'name',
      header: k('table.lead'),
      sortable: true,
      mobile: 'title',
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    { id: 'phone', header: k('table.phone'), cell: (r) => <Ltr>{r.phone}</Ltr> },
    { id: 'owner', header: k('table.owner'), cell: (r) => <OwnerChip name={r.owner} compact /> },
    {
      id: 'status',
      header: k('table.status'),
      cell: (r) =>
        r.state === 'acked' ? (
          <StatusBadge tone="success">{k('state.acked')}</StatusBadge>
        ) : r.state === 'overdue' ? (
          <StatusBadge tone="danger" strong>
            {k('state.overdue')}
          </StatusBadge>
        ) : (
          <StatusBadge tone="info">{k('state.waiting')}</StatusBadge>
        ),
    },
    {
      id: 'value',
      header: k('table.value'),
      align: 'end',
      cell: (r) => (r.value === null ? <MaskedValue /> : <Ltr className="tabular">{f.money(r.value)}</Ltr>),
    },
  ];

  const bars = [32, 46, 40, 58, 71, 64, 88];
  const line = [28, 38, 36, 52, 60, 68, 82];

  return (
    <div className="min-h-dvh pb-24">
      <TopNav
        items={navItems}
        signedIn
        roleLabel={t('role.owner')}
        availability={availability}
        onAvailabilityChange={setAvailability}
        notifications={notifications}
        timeWarp={60}
      />
      <main id="main" className="mx-auto w-full max-w-(--shell-max) space-y-12 px-(--page-pad) pt-4">
        <PageHeader
          hero
          art
          eyebrow={k('eyebrow', { locale })}
          title={k('title')}
          description={k('intro')}
          chips={
            <>
              <AlertChip
                icon={Clock3}
                tone="warning"
                label={k('chips.waiting')}
                count={f.number(3)}
                href="/leads"
              />
              <AlertChip
                icon={TriangleAlert}
                tone="danger"
                label={k('chips.escalated')}
                count={f.number(2)}
                href="/recovery"
              />
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-3" role="group" aria-label={k('toolbar')}>
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>

        <Section id="tokens" title={k('sections.tokens')}>
          <Card>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Swatch name="surface" cls="bg-surface" />
              <Swatch name="surface-muted" cls="bg-surface-muted" />
              <Swatch name="brand" cls="bg-brand" />
              <Swatch name="brand-strong" cls="bg-brand-strong" />
              <Swatch name="brand-soft" cls="bg-brand-soft" />
              <Swatch name="brand-faint" cls="bg-brand-faint" />
              <Swatch name="danger" cls="bg-danger" />
              <Swatch name="warning" cls="bg-warning" />
              <Swatch name="success" cls="bg-success" />
              <Swatch name="info" cls="bg-info" />
              <Swatch name="ai" cls="bg-ai" />
              <Swatch name="chart-3" cls="bg-chart-3" />
              <Swatch name="chart-4" cls="bg-chart-4" />
              <Swatch name="chart-5" cls="bg-chart-5" />
              <Swatch name="data-b" cls="bg-data-b" />
            </ul>
          </Card>
          <Card className="space-y-3">
            <p className="text-eyebrow text-fg-muted">{k('type.eyebrow')}</p>
            <p className="text-hero text-fg">{k('type.hero')}</p>
            <p className="text-page text-fg">{k('type.page')}</p>
            <p className="text-panel text-fg">{k('type.panel')}</p>
            <p className="text-kpi text-fg">
              <Ltr>{f.number(1286)}</Ltr>
            </p>
            <p className="text-body text-fg">{k('type.body')}</p>
            <p className="text-meta text-fg-2">{k('type.meta')}</p>
          </Card>
        </Section>

        <Section id="buttons" title={k('sections.buttons')}>
          <Card className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{k('btn.primary')}</Button>
            <Button variant="secondary">{k('btn.secondary')}</Button>
            <Button variant="ghost">{k('btn.ghost')}</Button>
            <Button variant="destructive">{k('btn.destructive')}</Button>
            <Button variant="link">{k('btn.link')}</Button>
            <Button variant="primary" disabled>
              {k('btn.disabled')}
            </Button>
            <Button
              variant="primary"
              loading={loadingBtn}
              onClick={() => {
                setLoadingBtn(true);
                window.setTimeout(() => setLoadingBtn(false), 1500);
              }}
            >
              {k('btn.loading')}
            </Button>
            <Button size="icon" variant="secondary" aria-label={k('btn.add')}>
              <Plus aria-hidden className="size-4" />
            </Button>
            <Button size="sm" variant="secondary">
              <UserPlus aria-hidden className="size-4" />
              {k('btn.small')}
            </Button>
          </Card>
        </Section>

        <Section id="forms" title={k('sections.forms')}>
          <Card className="grid gap-5 md:grid-cols-2">
            <FormField label={k('form.name')} helper={k('form.nameHelp')} required>
              {(p) => <Input {...p} defaultValue="Hamza Ali" />}
            </FormField>
            <FormField label={k('form.phone')} error={k('form.phoneError')} required>
              {(p) => <Input {...p} type="tel" dir="ltr" defaultValue="+92 300" />}
            </FormField>
            <FormField label={k('form.source')}>
              {(p) => (
                <Select defaultValue="form">
                  <SelectTrigger id={p.id} aria-describedby={p['aria-describedby']}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="form">{k('form.sourceForm')}</SelectItem>
                    <SelectItem value="whatsapp">{k('form.sourceWhatsapp')}</SelectItem>
                    <SelectItem value="manual">{k('form.sourceManual')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label={k('form.disabled')}>
              {(p) => <Input {...p} disabled defaultValue="PKR 25,000" />}
            </FormField>
            <FormField label={k('form.notes')} className="md:col-span-2">
              {(p) => <Textarea {...p} />}
            </FormField>
          </Card>
        </Section>

        <Section id="status" title={k('sections.status')}>
          <Card className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success">{k('state.acked')}</StatusBadge>
              <StatusBadge tone="warning">{k('state.awaiting')}</StatusBadge>
              <StatusBadge tone="danger" strong>
                {k('state.critical')}
              </StatusBadge>
              <StatusBadge tone="danger">{k('state.overdue')}</StatusBadge>
              <StatusBadge tone="info">{k('state.waiting')}</StatusBadge>
              <StatusBadge tone="neutral">{k('state.idle')}</StatusBadge>
              <StatusBadge tone="disabled">{k('state.closed')}</StatusBadge>
              <AIBadge />
              <AIBadge>14:02</AIBadge>
              <MaskedValue />
              <TimeWarpBadge factor={60} />
            </div>
            <div className="flex flex-wrap gap-6">
              <OwnerChip name="Sara Khan" availability="available" />
              <OwnerChip name="Bilal Ahmed" availability="busy" />
              <OwnerChip name="Noor Fatima" availability="onLeave" />
              <OwnerChip name="Imran Shah" availability="offline" />
              <OwnerChip
                name="Zainab Qureshi"
                availability="available"
                fallback
                fallbackReason={k('sample.fallbackReason')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <AlertChip
                icon={Clock3}
                tone="warning"
                label={k('chips.waiting')}
                count={f.number(3)}
                href="/leads"
              />
              <AlertChip
                icon={TriangleAlert}
                tone="danger"
                label={k('chips.escalated')}
                count={f.number(2)}
                href="/recovery"
              />
              <AlertChip icon={Inbox} label={k('chips.unread')} count={f.number(12)} href="/inbox" />
              <AvailabilitySwitcher value={availability} onChange={setAvailability} />
            </div>
          </Card>
        </Section>

        <Section id="countdown" title={k('sections.countdown')}>
          <Card className="grid gap-6 md:grid-cols-2">
            {(
              [
                ['ok', 100],
                ['warning', 45],
                ['danger', 15],
                ['overdue', -25],
              ] as const
            ).map(([name, secs]) => (
              <div key={name} className="flex flex-wrap items-center gap-5">
                <CountdownRing endsAt={ends(secs)} windowMs={WINDOW} nowMs={NOW} size={96} />
                <CountdownRing endsAt={ends(secs)} windowMs={WINDOW} nowMs={NOW} size={40} />
                <CountdownRing endsAt={ends(secs)} windowMs={WINDOW} nowMs={NOW} size={20} />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-5">
              {liveEnds ? <CountdownRing endsAt={liveEnds} windowMs={WINDOW} size={40} warp={60} /> : null}
              <p className="text-meta text-fg-2">{k('countdown.live')}</p>
            </div>
          </Card>
        </Section>

        <Section id="kpi" title={k('sections.kpi')}>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiTile
              icon={<UserPlus />}
              label={k('kpi.newLeads')}
              value={<Ltr>{f.number(12)}</Ltr>}
              delta={{ text: f.percent(0.08), direction: 'up', tone: 'good' }}
              compareLabel={k('kpi.vsYesterday')}
              spark={[4, 6, 5, 8, 7, 10, 12]}
              href="/leads"
            />
            <KpiTile
              icon={<Clock3 />}
              label={k('kpi.response')}
              value={<Ltr>{f.number(4)}</Ltr>}
              delta={{ text: f.percent(0.16), direction: 'down', tone: 'good' }}
              compareLabel={k('kpi.vsYesterday')}
              spark={[9, 8, 8, 7, 6, 5, 4]}
            />
            <KpiTile
              icon={<TriangleAlert />}
              label={k('kpi.escalations')}
              value={<Ltr>{f.number(5)}</Ltr>}
              delta={{ text: f.percent(0.25), direction: 'up', tone: 'bad' }}
              compareLabel={k('kpi.vsYesterday')}
              spark={[2, 2, 3, 3, 4, 4, 5]}
            />
            <KpiTile
              icon={<Wallet />}
              label={k('kpi.revenue')}
              value={<MaskedValue />}
              compareLabel={k('kpi.vsLastMonth')}
            />
            <KpiTile icon={<Users />} label={k('kpi.loading')} state="loading" />
            <KpiTile icon={<Inbox />} label={k('kpi.empty')} state="empty" emptyText={k('kpi.emptyText')} />
            <KpiTile
              icon={<Trophy />}
              label={k('kpi.error')}
              state="error"
              onRetry={() => toast.info(k('toast.retrying'))}
            />
          </div>
        </Section>

        <Section id="charts" title={k('sections.charts')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={k('chart.title')}
              scope={k('chart.scope')}
              unit={k('chart.unit')}
              legend={[
                { label: k('chart.collected'), swatch: 'bg-chart-primary' },
                { label: k('chart.count'), swatch: 'bg-chart-secondary' },
              ]}
              actions={
                <Select defaultValue="30">
                  <SelectTrigger aria-label={k('chart.period')} className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">{k('chart.days7')}</SelectItem>
                    <SelectItem value="30">{k('chart.days30')}</SelectItem>
                  </SelectContent>
                </Select>
              }
              summary={<p>{k('chart.summaryText')}</p>}
            >
              <svg viewBox="0 0 320 140" className="h-40 w-full" role="img" aria-label={k('chart.title')}>
                {[0, 1, 2, 3].map((i) => (
                  <line
                    key={i}
                    x1="0"
                    x2="320"
                    y1={20 + i * 36}
                    y2={20 + i * 36}
                    strokeWidth="1"
                    className="stroke-chart-grid"
                  />
                ))}
                {bars.map((b, i) => (
                  <rect
                    key={i}
                    x={14 + i * 44}
                    y={128 - b * 1.2}
                    width="26"
                    height={b * 1.2}
                    rx="4"
                    className={i === bars.length - 1 ? 'fill-brand' : 'fill-chart-secondary'}
                  />
                ))}
                <polyline
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="stroke-chart-primary"
                  points={line.map((v, i) => `${27 + i * 44},${128 - v * 1.2}`).join(' ')}
                />
                {line.map((v, i) => (
                  <circle
                    key={i}
                    cx={27 + i * 44}
                    cy={128 - v * 1.2}
                    r="3.5"
                    className="fill-chart-primary"
                  />
                ))}
              </svg>
            </ChartCard>
            <div className="grid gap-4">
              <ChartCard title={k('chart.loadingTitle')} state="loading" />
              <ChartCard
                title={k('chart.emptyTitle')}
                state="empty"
                emptyTitle={k('chart.emptyReason')}
                emptyAction={<Button variant="secondary">{k('chart.emptyAction')}</Button>}
              />
              <ChartCard
                title={k('chart.errorTitle')}
                state="error"
                onRetry={() => toast.info(k('toast.retrying'))}
              />
            </div>
          </div>
        </Section>

        <Section id="table" title={k('sections.table')}>
          <DataTable
            columns={columns}
            rows={sorted}
            rowKey={(r) => r.id}
            caption={k('table.caption')}
            sort={sort}
            onSortChange={setSort}
            onRowOpen={() => toast.info(k('toast.opened'))}
            footer={<Button variant="secondary">{k('table.loadMore')}</Button>}
          />
          <DataTable
            columns={columns}
            rows={[]}
            rowKey={(r) => r.id}
            caption={k('table.caption')}
            empty={
              <Card>
                <EmptyState
                  icon={Inbox}
                  headingLevel={3}
                  title={k('empty.title')}
                  description={k('empty.body')}
                  action={<Button variant="primary">{k('empty.action')}</Button>}
                />
              </Card>
            }
          />
          <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} caption={k('table.caption')} loading />
        </Section>

        <Section id="overlays" title={k('sections.overlays')}>
          <Card className="flex flex-wrap items-center gap-3">
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="secondary">{k('overlay.drawer')}</Button>
              </DrawerTrigger>
              <DrawerContent title={k('overlay.drawerTitle')} description={k('overlay.drawerBody')}>
                <div className="space-y-4">
                  <OwnerChip name="Sara Khan" availability="available" />
                  <CountdownRing endsAt={ends(60)} windowMs={WINDOW} nowMs={NOW} size={40} />
                </div>
              </DrawerContent>
            </Drawer>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">{k('overlay.dialog')}</Button>
              </DialogTrigger>
              <DialogContent title={k('overlay.dialogTitle')} description={k('overlay.dialogBody')}>
                <FormField label={k('form.name')}>{(p) => <Input {...p} />}</FormField>
                <DialogFooter>
                  <Button variant="primary">{k('overlay.save')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              {k('overlay.confirm')}
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              destructive
              title={k('overlay.confirmTitle')}
              description={k('overlay.confirmBody')}
              confirmLabel={k('overlay.confirmAction')}
              onConfirm={() => {
                setConfirmOpen(false);
                toast.success(k('toast.done'));
              }}
            />
            <Button variant="secondary" onClick={() => toast.success(k('toast.success'))}>
              {k('toast.showSuccess')}
            </Button>
            <Button variant="secondary" onClick={() => toast.error(k('toast.error'))}>
              {k('toast.showError')}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">{k('overlay.popover')}</Button>
              </PopoverTrigger>
              <PopoverContent>{k('overlay.popoverBody')}</PopoverContent>
            </Popover>
            <Tooltip content={k('overlay.tooltipBody')}>
              <Button variant="secondary">{k('overlay.tooltip')}</Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">{k('overlay.menu')}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>
                  <ArrowUpRight aria-hidden />
                  {k('overlay.menuOpen')}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Phone aria-hidden />
                  {k('overlay.menuCall')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{k('overlay.menuDisabled')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <NotificationsPanel items={notifications} nowMs={NOW} />
          </Card>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">{k('tabs.overview')}</TabsTrigger>
              <TabsTrigger value="b">{k('tabs.activity')}</TabsTrigger>
              <TabsTrigger value="c">{k('tabs.payments')}</TabsTrigger>
            </TabsList>
            <TabsContent value="a">
              <Card>{k('tabs.bodyA')}</Card>
            </TabsContent>
            <TabsContent value="b">
              <Card>{k('tabs.bodyB')}</Card>
            </TabsContent>
            <TabsContent value="c">
              <Card>{k('tabs.bodyC')}</Card>
            </TabsContent>
          </Tabs>
        </Section>

        <Section id="states" title={k('sections.states')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <EmptyState
                icon={Trophy}
                headingLevel={3}
                title={k('empty.recoveryTitle')}
                description={k('empty.recoveryBody')}
              />
            </Card>
            <Card>
              <CardHeader icon={<Inbox />} title={k('skeleton.title')} description={k('skeleton.body')} />
              <SkeletonGroup className="mt-4 space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-4/5" />
                <Skeleton className="h-10 w-3/5" />
              </SkeletonGroup>
            </Card>
          </div>
        </Section>

        <Section id="format" title={k('sections.format')}>
          <Card>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <FormatRow label={k('format.money')} value={<Ltr>{f.money(2_500_000)}</Ltr>} />
              <FormatRow
                label={k('format.compact')}
                value={<Ltr>{f.money(125_000_000_00, undefined, { compact: true })}</Ltr>}
              />
              <FormatRow label={k('format.number')} value={<Ltr>{f.number(1234567)}</Ltr>} />
              <FormatRow label={k('format.percent')} value={<Ltr>{f.percent(0.325, 1)}</Ltr>} />
              <FormatRow label={k('format.date')} value={f.dateTime(NOW)} />
              <FormatRow label={k('format.relative')} value={f.relative(NOW - 5 * 60_000, NOW)} />
              <FormatRow label={k('format.phone')} value={<Ltr>+92 300 1234567</Ltr>} />
              <FormatRow label={k('format.zone')} value={<Ltr>{f.timeZone}</Ltr>} />
            </dl>
          </Card>
        </Section>

        <Section id="art" title={k('sections.art')}>
          <Card className="relative overflow-hidden">
            <GlassArt className="!block h-48 w-full" />
          </Card>
        </Section>
      </main>
    </div>
  );
}

function FormatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className="text-body text-fg">{value}</dd>
    </div>
  );
}
