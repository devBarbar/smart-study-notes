Feature: Startup telemetry
  Launch telemetry should not activate crash-adjacent native collectors unless the build opts in.

  Scenario: Opening the app keeps native telemetry collectors disabled by default
    Given production telemetry is configured without replay opt in
    When the app prepares startup telemetry
    Then startup telemetry reports native replay and profiling disabled

  Scenario: Opening the app enables Sentry when a production DSN exists
    Given production telemetry is configured without replay opt in
    When the app prepares startup telemetry
    Then startup telemetry reports Sentry enabled
    And startup telemetry emits one Sentry startup signal

  Scenario: A profile sample rate alone does not activate native profiling
    Given production telemetry is configured with a profile sample rate only
    When the app prepares startup telemetry
    Then startup telemetry reports native replay and profiling disabled

  Scenario: Diagnostic checkpoints are visible in Sentry logs and breadcrumbs
    Given production telemetry is configured without replay opt in
    When the app records a diagnostic checkpoint
    Then startup telemetry emits one diagnostic log and breadcrumb
