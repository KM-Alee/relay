// Stage rot (T-221, F2.9): the rotting-deals read model. Rotting opportunities feed the recovery queue:
// Lane A2's recovery service calls `listRottingOpportunities(actor)` (or `rottingRows` from repos/crm-rot)
// for its "R6 rotting deal" section; the pipeline page shows the same list as a "Rotting deals" panel.
import type { RotItem } from '@relay/contracts/api/crm-extras';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { rottingRows, type RottingRow } from '../repos/crm-rot';
import { opportunityDtos, type OpportunityRow } from './crm-records';
import { scopeSql } from './crm-shared';

/** Open opportunities past their stage's rot period, in the actor's visibility scope, value masked. */
export async function listRottingOpportunities(
  actor: Actor,
  query: { pipelineId?: string } = {},
  opts: TxOptions = {},
): Promise<{ items: RotItem[] }> {
  assertPermission(actor, 'crm.opportunity.view');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const rs = await rottingRows(tx, {
        workspaceId: actor.workspaceId,
        scope: scopeSql(actor, 'opportunity'),
        pipelineId: query.pipelineId,
      });
      const dtos = await opportunityDtos(tx, actor, rs as unknown as OpportunityRow[]);
      const byId = new Map(rs.map((r) => [r.id, r] as const));
      return {
        items: dtos.map((opportunity) => {
          const r = byId.get(opportunity.id) as RottingRow;
          return {
            opportunity,
            stageId: r.stage_id,
            stageName: r.stage_name,
            pipelineId: r.pipeline_id,
            rotSeconds: r.rot_seconds,
            idleSeconds: Number(r.idle_seconds),
          };
        }),
      };
    },
    opts,
  );
}
