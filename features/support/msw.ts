import { AfterAll, After, BeforeAll } from '@cucumber/cucumber';

import {
  resetSupabaseRequests,
  supabaseServer,
} from '../../tests/utils/supabase-msw';

BeforeAll(() => {
  supabaseServer.listen({ onUnhandledRequest: 'error' });
});

After(() => {
  resetSupabaseRequests();
  supabaseServer.resetHandlers();
});

AfterAll(() => {
  supabaseServer.close();
});

