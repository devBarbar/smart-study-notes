Feature: Canvas-first listening notes for tutor checks
  Students should listen and write notes before answering normal tutor checks.

  Scenario: Depth tutor checks move from listening notes to a clean answer page
    Given a depth tutor response with a check-in question
    When the tutor response arrives
    Then the student sees the listening notes canvas
    And answer submission is disabled
    When the explanation audio finishes
    Then the student sees a clean answer canvas
    And answer submission is enabled
    And the depth check still counts toward mastery

  Scenario Outline: Non-depth setup checks do not enter listening notes
    Given a <assessmentKind> tutor response with a check-in question
    When the tutor response arrives
    Then the student does not see the listening notes canvas

    Examples:
      | assessmentKind |
      | diagnostic     |
      | final_quiz     |

  Scenario: Missing tutor questions do not enter listening notes
    Given no tutor question is available
    Then the response is not eligible for listening notes

  Scenario Outline: Listening audio removes the final question only when safe
    Given the listening audio preset <preset>
    Then the prepared listening audio is "<audioText>"

    Examples:
      | preset            | audioText                    |
      | no_question       | Explanation only.            |
      | missing_question  | Explanation only.            |
      | embedded_question | Prompt? More explanation.    |
      | trailing_question | Explanation before question. |
