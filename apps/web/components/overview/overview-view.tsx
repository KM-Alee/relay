'use client';
// Overview (T-150, screens.md section 2): header sentence + attention chips, 3 KPI tiles, payments chart,
// team availability, pipeline, appointments, escalations; role-aware (F5.4), hide/show remembered (F5.5),
// drill-down links on most figures (F5.3). The Radar tab (T-201) lives beside it.
import { useQuery } from '@tanstack/react-query';
import { Clock3, LifeBuoy, Siren, TimerReset, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertChip } from '@/components/relay/alert-chip';
import { KpiTile, type KpiDelta } from '@/components/relay/kpi-tile';
import { PageHeader } from '@/components/relay/page-header';
import { api } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { qk } from '@/lib/query/keys';
import { AboutCard } from './about-card';
import { AppointmentsCard, EscalationsCard, PipelineCard, RevenueHero, TeamAvailabilityCard } from './cards';
import { CustomizeDialog } from './customize-dialog';
import { useHiddenFigures } from './figure-prefs';
import { changeFraction, formatDurationShort, type FigureId } from './helpers';
import { PaymentsChart } from './payments-chart';
import { RadarView } from './radar-view';
import { PanelFade, Reveal } from './reveal';
import { Ticker } from './ticker';

type Part = 'morning' | 'afternoon' | 'evening';

export function OverviewView({
  eyebrow,
  part,
  initialTab,
}: {
  eyebrow: string;
  part: Part;
  initialTab: 'summary' | 'radar';
}) {
  const t = useTranslations('overview');
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<'summary' | 'radar'>(initialTab);
  const [days, setDays] = useState(30);

  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }), retry: false });
  const q = useQuery({
    queryKey: qk.dashboard(`overview:${days}`),
    queryFn: ({ signal }) => api.dashboard.overview({ days }, { signal }),
    placeholderData: (prev) => prev,
  });
  const prefs = useHiddenFigures(me.data?.user.id);

  const data = q.data;
  const state: 'ready' | 'loading' | 'error' = q.isError && !data ? 'error' : !data ? 'loading' : 'ready';
  const retry = () => void q.refetch();
  const mine = data?.scope === 'mine';
  const demo = me.data?.workspace.demoMode === true;
  const firstName = me.data?.user.name.split(/\s+/)[0];
  const greeting = firstName
    ? t('greeting.named', { greeting: t(`greeting.${part}`), name: firstName })
    : t(`greeting.${part}`);

  const onTab = (v: string) => {
    const next = v === 'radar' ? 'radar' : 'summary';
    setTab(next);
    router.replace(next === 'radar' ? `${pathname}?tab=radar` : pathname, { scroll: false });
  };

  const show = (id: FigureId) => !prefs.isHidden(id);
  const available = new Set<FigureId>(
    [
      'newLeads',
      'response',
      'recovery',
      'payments',
      'team',
      'pipeline',
      'appointments',
      'escalations',
    ].concat(mine ? [] : ['risk'], demo ? ['about'] : []) as FigureId[],
  );

  // KPI 1
  const nl = data?.newLeadsToday;
  const nlDelta: KpiDelta | undefined =
    nl && nl.previous !== null
      ? {
          text: f.number(Math.abs(nl.value - nl.previous)),
          direction: nl.value > nl.previous ? 'up' : nl.value < nl.previous ? 'down' : 'flat',
          tone: nl.value > nl.previous ? 'good' : 'neutral',
        }
      : undefined;
  // KPI 2 (lower is better)
  const fr = data?.avgFirstResponse;
  const frChange = fr && fr.seconds !== null ? changeFraction(fr.seconds, fr.previousSeconds) : null;
  const frDelta: KpiDelta | undefined =
    frChange !== null
      ? {
          text: f.percent(Math.abs(frChange)),
          direction: frChange > 0.005 ? 'up' : frChange < -0.005 ? 'down' : 'flat',
          tone: frChange > 0.005 ? 'bad' : frChange < -0.005 ? 'good' : 'neutral',
        }
      : undefined;

  const chips = data ? (
    <>
      <AlertChip
        icon={Clock3}
        tone="warning"
        label={t('chips.waiting')}
        count={f.number(data.attention.waitingAck)}
        href="/leads?state=pending"
      />
      <AlertChip
        icon={Siren}
        tone="danger"
        label={t('chips.escalated')}
        count={f.number(data.attention.escalatedToday)}
        href="/leads?escalated=today"
      />
    </>
  ) : undefined;

  const tileState = state;
  const kpiHidden = !show('newLeads') && !show('response') && !show('recovery');

  return (
    <>
      <div className="relative">
        <PageHeader
          hero
          art
          eyebrow={eyebrow}
          title={greeting}
          description={
            data
              ? t(mine ? 'header.sentenceMine' : 'header.sentence', {
                  newToday: data.newLeadsToday.value,
                  attention: f.number(data.attention.needAttention),
                })
              : t('subtitle')
          }
          chips={chips}
        />
        {show('risk') && !mine ? (
          <RevenueHero
            data={data}
            className="relative z-10 mb-2 md:absolute md:end-2 md:top-8 md:mb-0 md:w-[min(460px,44%)]"
          />
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={onTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t('tabs.label')}>
            <TabsTrigger value="summary">{t('tabs.summary')}</TabsTrigger>
            <TabsTrigger value="radar">{t('tabs.radar')}</TabsTrigger>
          </TabsList>
          {tab === 'summary' ? (
            <CustomizeDialog
              hidden={prefs.hidden}
              onToggle={prefs.toggle}
              onReset={prefs.reset}
              available={available}
            />
          ) : null}
        </div>

        <TabsContent value="summary" className="space-y-4">
          <PanelFade>
            {demo && show('about') ? (
              <Reveal lift={false}>
                <AboutCard onDismiss={() => prefs.toggle('about')} />
              </Reveal>
            ) : null}

            {!kpiHidden ? (
              <div className="grid gap-4 md:grid-cols-3">
                {show('newLeads') ? (
                  <Reveal i={1}>
                    <KpiTile
                      icon={<UserPlus />}
                      label={mine ? t('kpi.newLeadsMine') : t('kpi.newLeads')}
                      state={tileState}
                      onRetry={retry}
                      value={nl ? <Ticker value={nl.value} format={(n) => f.number(n)} /> : null}
                      delta={nlDelta}
                      compareLabel={
                        nl && nl.previous !== null
                          ? t('kpi.vsYesterday', { value: f.number(nl.previous) })
                          : undefined
                      }
                      spark={nl?.spark}
                      href="/leads?created=today"
                    />
                  </Reveal>
                ) : null}
                {show('response') ? (
                  <Reveal i={2}>
                    <KpiTile
                      icon={<TimerReset />}
                      label={mine ? t('kpi.responseMine') : t('kpi.response')}
                      state={
                        tileState === 'ready' && fr?.seconds === null && !fr.spark.some(Boolean)
                          ? 'empty'
                          : tileState
                      }
                      emptyText={t('kpi.noResponses')}
                      onRetry={retry}
                      value={
                        fr?.seconds !== null && fr
                          ? formatDurationShort(f.locale, fr.seconds ?? 0)
                          : t('kpi.noResponses')
                      }
                      delta={frDelta}
                      compareLabel={
                        fr?.previousSeconds
                          ? t('kpi.vsYesterday', { value: formatDurationShort(f.locale, fr.previousSeconds) })
                          : undefined
                      }
                      spark={fr?.spark.some(Boolean) ? fr.spark : undefined}
                    />
                  </Reveal>
                ) : null}
                {show('recovery') ? (
                  <Reveal i={3}>
                    <KpiTile
                      icon={<LifeBuoy />}
                      label={mine ? t('kpi.recoveryMine') : t('kpi.recovery')}
                      state={tileState}
                      onRetry={retry}
                      value={
                        data ? <Ticker value={data.recoveryQueue.count} format={(n) => f.number(n)} /> : null
                      }
                      compareLabel={
                        data
                          ? data.recoveryQueue.critical > 0
                            ? t('kpi.critical', { count: data.recoveryQueue.critical })
                            : t('kpi.allClear')
                          : undefined
                      }
                      href="/recovery"
                    />
                  </Reveal>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              {show('payments') ? (
                <Reveal i={4} lift={false} className="lg:col-span-2">
                  <PaymentsChart
                    data={data}
                    days={days}
                    onDaysChange={setDays}
                    state={state}
                    onRetry={retry}
                  />
                </Reveal>
              ) : null}
              {show('team') ? (
                <Reveal i={5}>
                  <TeamAvailabilityCard data={data} state={state} onRetry={retry} />
                </Reveal>
              ) : null}
              {show('pipeline') ? (
                <Reveal i={6}>
                  <PipelineCard data={data} state={state} onRetry={retry} />
                </Reveal>
              ) : null}
              {show('appointments') ? (
                <Reveal i={7}>
                  <AppointmentsCard data={data} state={state} onRetry={retry} />
                </Reveal>
              ) : null}
              {show('escalations') ? (
                <Reveal i={8}>
                  <EscalationsCard data={data} state={state} onRetry={retry} />
                </Reveal>
              ) : null}
            </div>
          </PanelFade>
        </TabsContent>

        <TabsContent value="radar">
          {tab === 'radar' ? (
            <PanelFade>
              <RadarView />
            </PanelFade>
          ) : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
