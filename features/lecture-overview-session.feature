Feature: Lecture overview session continuation
  Students should resume the relevant session from the lecture overview.

  Scenario: Continue opens the most recent session for the suggested topic
    Given a lecture overview has an older full session and a newer suggested topic session
    When the student continues from the lecture overview
    Then the suggested topic session is opened
