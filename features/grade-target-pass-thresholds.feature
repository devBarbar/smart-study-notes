Feature: Grade target pass thresholds
  Students should pass topics according to the grade target they selected.

  Scenario Outline: Target grade controls the required score
    Given the learner selected target grade <targetGrade>
    When the learner receives a score of <score>
    Then the score is marked <status>

    Examples:
      | targetGrade | score | status     |
      | pass        | 70    | passed     |
      | 2.0         | 71    | not passed |
      | 2.0         | 72    | passed     |
      | 1.7         | 76    | not passed |
      | 1.7         | 77    | passed     |
      | 1.3         | 80    | not passed |
      | 1.3         | 81    | passed     |
      | 1.0         | 85    | not passed |
      | 1.0         | 86    | passed     |
