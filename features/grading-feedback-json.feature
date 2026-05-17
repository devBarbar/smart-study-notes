Feature: Tutor grading feedback JSON cleanup
  Students should never see raw grading JSON in tutor feedback.

  Scenario: Prose-wrapped grading JSON is shown as readable feedback
    Given prose-wrapped grading feedback from the model
    When the feedback is prepared for the student
    Then the feedback summary is "The main gap is memory placement."
    And the feedback hides the raw key "whatWentRight"
