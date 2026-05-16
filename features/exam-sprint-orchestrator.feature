Feature: Exam sprint orchestrator
  Students should get a deadline-aware crash-course plan from the lecture overview.

  Scenario: Sprint panel recommends the highest-risk high-yield topic first
    Given a lecture has an exam in three days with mixed topic progress
    When the student opens the exam sprint panel
    Then today's next sprint action targets the high-yield weak topic
    When the student starts the sprint next action
    Then the app opens that topic from the sprint panel
