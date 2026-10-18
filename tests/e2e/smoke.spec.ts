import { expect, test } from '@playwright/test';

test('[Q14] the web app responds on /', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
});
