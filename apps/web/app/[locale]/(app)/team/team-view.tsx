'use client';
import { KeyRound, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageHeader } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/lib/i18n/navigation';
import { InviteDialog, InvitesTab } from './invites-tab';
import { MembersTab } from './members-tab';

export interface TeamViewProps {
  selfId: string;
  isOwner: boolean;
  canInvite: boolean;
  canManageRoles: boolean;
}

export function TeamView(props: TeamViewProps) {
  const t = useTranslations('team');
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/team/roles">
                <Icon icon={KeyRound} />
                {t('rolesLink')}
              </Link>
            </Button>
            {props.canInvite ? (
              <Button variant="primary" onClick={() => setInviteOpen(true)}>
                <Icon icon={UserPlus} />
                {t('invite')}
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs defaultValue="members">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>
          {props.canInvite ? <TabsTrigger value="invites">{t('tabs.invites')}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="members">
          <MembersTab {...props} />
        </TabsContent>
        {props.canInvite ? (
          <TabsContent value="invites">
            <InvitesTab />
          </TabsContent>
        ) : null}
      </Tabs>
      {props.canInvite ? (
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isOwner={props.isOwner} />
      ) : null}
    </>
  );
}
