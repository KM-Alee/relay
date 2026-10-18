'use client';
// Automations (screens.md §6, T-124/T-202/T-210): escalation rule builder, assignment settings, teams,
// lead sources + web forms, and the demo time-warp control.
import { useQuery } from '@tanstack/react-query';
import { Globe, ListChecks, Shuffle, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/relay/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { AssignmentSettings } from './assignment-settings';
import { IntakeSettings } from './intake-settings';
import { PolicyEditor } from './policy-editor';
import { TeamsManager } from './teams-manager';
import { TimeWarpControl } from './time-warp-control';

export function AutomationsView() {
  const t = useTranslations('automations');
  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }) });
  const canWarp = me.data?.permissions.includes('workspace.settings') ?? false;
  const tabs = [
    { id: 'escalation', icon: ListChecks },
    { id: 'assignment', icon: Shuffle },
    { id: 'teams', icon: UsersRound },
    { id: 'intake', icon: Globe },
  ] as const;
  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={<TimeWarpControl canChange={canWarp} />}
      />
      <Tabs defaultValue="escalation">
        <TabsList aria-label={t('tabs.label')}>
          {tabs.map(({ id, icon: Icon }) => (
            <TabsTrigger key={id} value={id}>
              <Icon aria-hidden className="size-4" />
              {t(`tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="escalation">
          <PolicyEditor />
        </TabsContent>
        <TabsContent value="assignment">
          <AssignmentSettings />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsManager />
        </TabsContent>
        <TabsContent value="intake">
          <IntakeSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
