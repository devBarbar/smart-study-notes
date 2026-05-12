import * as Sentry from "npm:@sentry/deno@10.53.0";

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") ?? Deno.env.get("SENTRY_DENO_DSN");
const SENTRY_ENVIRONMENT =
  Deno.env.get("SENTRY_ENVIRONMENT") ?? Deno.env.get("ENVIRONMENT") ?? "production";
const SENTRY_RELEASE = Deno.env.get("SENTRY_RELEASE");
const SENTRY_TRACES_SAMPLE_RATE = Number(Deno.env.get("SENTRY_TRACES_SAMPLE_RATE") ?? "1");
const SENTRY_DEBUG = Deno.env.get("SENTRY_DEBUG") === "true";

let initialized = false;

const parseSampleRate = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const decodeBase64UrlJson = (value: string): Record<string, unknown> | null => {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const getJwtPayload = (req: Request) => {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  return decodeBase64UrlJson(payload);
};

const initSentry = () => {
  if (initialized) return;
  initialized = true;

  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: Boolean(SENTRY_DSN),
    debug: SENTRY_DEBUG,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    sendDefaultPii: true,
    tracesSampleRate: parseSampleRate(SENTRY_TRACES_SAMPLE_RATE, 1),
  });
};

export const setSentryUser = (userId: string | null | undefined, email?: string | null) => {
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: userId, email: email ?? undefined });
};

export const setSentryJobContext = (
  job: { id?: string | null; type?: string | null; user_id?: string | null } | null | undefined,
) => {
  if (!job) return;
  if (job.user_id) setSentryUser(job.user_id);
  if (job.id) Sentry.setTag("job.id", job.id);
  if (job.type) Sentry.setTag("job.type", job.type);
};

export const captureSentryException = (
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
) => {
  Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
  });
};

export const withSentry = (
  functionName: string,
  handler: (req: Request) => Response | Promise<Response>,
) => {
  initSentry();

  return (req: Request) =>
    Sentry.withIsolationScope((scope) => {
      const url = new URL(req.url);
      const jwtPayload = getJwtPayload(req);
      const userId = typeof jwtPayload?.sub === "string" ? jwtPayload.sub : undefined;
      const email = typeof jwtPayload?.email === "string" ? jwtPayload.email : undefined;

      scope.setTag("edge.function", functionName);
      scope.setContext("request", {
        method: req.method,
        path: url.pathname,
        hasAuth: Boolean(req.headers.get("authorization") ?? req.headers.get("Authorization")),
      });
      if (userId) scope.setUser({ id: userId, email });

      return Sentry.continueTrace(
        {
          sentryTrace: req.headers.get("sentry-trace") ?? undefined,
          baggage: req.headers.get("baggage") ?? undefined,
        },
        () =>
          Sentry.startSpan(
            {
              name: `${req.method} ${functionName}`,
              op: "http.server",
              forceTransaction: true,
              attributes: {
                "http.request.method": req.method,
                "url.path": url.pathname,
                "supabase.function": functionName,
              },
            },
            async (span) => {
              try {
                const response = await handler(req);
                span.setAttribute("http.response.status_code", response.status);
                Sentry.setHttpStatus(span, response.status);
                if (response.status >= 500) {
                  let responseBody: string | undefined;
                  try {
                    responseBody = (await response.clone().text()).slice(0, 1000);
                  } catch {
                    responseBody = undefined;
                  }
                  Sentry.captureMessage(`${functionName} returned HTTP ${response.status}`, {
                    level: "error",
                    tags: { "edge.function": functionName },
                    extra: { responseBody },
                  });
                }
                return response;
              } catch (error) {
                Sentry.setHttpStatus(span, 500);
                captureSentryException(error, { tags: { "edge.function": functionName } });
                throw error;
              } finally {
                await Sentry.flush(2000);
              }
            },
          ),
      );
    });
};
