Feature: Lecture progress reset
  Students can restart a lecture without uploading its materials again.

  Scenario: Resetting progress keeps materials and the study plan
    Given a lecture has uploaded materials, a study plan, and existing progress
    When the student resets the lecture progress
    Then the lecture materials and study plan remain
    And the sessions, flashcards, practice exams, and cheat sheet are cleared
