import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

type SupabaseRequest = {
  method: string;
  url: string;
  body: unknown;
};

const requests: SupabaseRequest[] = [];

export const supabaseRequests = requests;

export const supabaseServer = setupServer(
  http.patch('https://unit-test.supabase.co/rest/v1/:table', async ({ request }) => {
    requests.push({
      method: request.method,
      url: request.url,
      body: await request.json().catch(() => null),
    });
    return HttpResponse.json([]);
  }),
  http.get('https://unit-test.supabase.co/rest/v1/:table', () =>
    HttpResponse.json([]),
  ),
  http.post('https://unit-test.supabase.co/rest/v1/:table', async ({ request }) => {
    requests.push({
      method: request.method,
      url: request.url,
      body: await request.json().catch(() => null),
    });
    return HttpResponse.json([]);
  }),
);

export const resetSupabaseRequests = () => {
  requests.splice(0, requests.length);
};

