Feature: Lecture overview session continuation
  Students should resume the relevant session from the lecture overview.

  Scenario: Continue opens the most recent session for the suggested topic
    Given a lecture overview has an older full session and a newer suggested topic session
    When the student continues from the lecture overview
    Then the suggested topic session is opened

  Scenario: Refresh readiness insights from the overview
    Given a lecture overview has depth-weighted readiness available
    When the student refreshes AI insights from the lecture overview
    Then the readiness roadmap refresh is triggered
