import * as Sentry from '@sentry/browser';
import { name, version } from '../../package.json';
// Sentry init — imported first by main.ts so boot-time failures are captured
// too. No-ops entirely when VITE_SENTRY_DSN isn't set.
if (import.meta.env.VITE_SENTRY_DSN) Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: `${name}@${version}`,
  environment: import.meta.env.MODE, // 'development' | 'production'
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
    // the whole UI is canvas — without this replays show a blank page;
    // note canvas pixels are never masked (Sentry can't scrub them)
    Sentry.replayCanvasIntegration(),
    Sentry.captureConsoleIntegration({ levels: ['error'] }), // console.error -> Sentry event
    // no floating DOM button — the canvas UI's "report a problem" link opens
    // the dialog via telemetry.report(); the sync variant bundles the modal
    // so it never lazy-loads Sentry's CDN at click time
    Sentry.feedbackSyncIntegration({ autoInject: false, colorScheme: 'system' }),
  ],
  tracesSampleRate: 1.0,
  // no trace propagation — the app only talks to third-party hosts
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
