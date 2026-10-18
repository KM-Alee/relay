// api.dashboard.*: owner Lane D. One method per endpoint in contracts/api/dashboard.ts; pattern: ./users.ts.
import { dashboardEndpoints, type OverviewQuery } from '@relay/contracts/api/dashboard';
import { dashboardFixtures } from '@relay/contracts/fixtures/dashboard';
import { call, type CallOptions } from '../http';

export const dashboard = {
  overview: (query: OverviewQuery = {}, opts?: CallOptions) =>
    call('dashboard', dashboardEndpoints.overview, { query }, () => dashboardFixtures.overview(), opts),
  radar: (opts?: CallOptions) =>
    call('dashboard', dashboardEndpoints.radar, {}, () => dashboardFixtures.radar(), opts),
};
