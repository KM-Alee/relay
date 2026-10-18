// Per-worker setup for integration tests: runtime code (getDb) connects as app_user to the test DB.
import { testDbUrls } from './db-urls';

const { appUrl } = testDbUrls();
process.env.DATABASE_URL = appUrl;
