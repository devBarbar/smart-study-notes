Feature: Study canvas and chat view toggle
  Students can move between the answer canvas and tutor chat during a study session.

  Scenario: Canvas and chat toggle buttons preserve the active answer phase
    Given the study session view toggle harness is on the answer canvas
    When the student opens the tutor chat from the canvas
    Then the tutor chat view is visible
    And the answer phase is still active
    When the student returns to the answer canvas
    Then the answer canvas view is visible
    And the answer phase is still active

  Scenario: Submitting an answer from chat returns grading to the canvas
    Given the study session view toggle harness is on the tutor chat during answer mode
    When the student submits an answer from the chat
    Then the answer canvas view is visible
    And the canvas grading state is visible
