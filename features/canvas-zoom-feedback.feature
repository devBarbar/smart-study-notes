Feature: Canvas zoom and inline grading feedback
  Students can resize the answer canvas and see tutor grading directly below their answer.

  Scenario: Zoom controls make the canvas smaller and larger
    Given the study canvas zoom harness is open
    When the student zooms out
    Then the canvas zoom reads "75%"
    And the paper still fills the canvas viewport
    When the student zooms in
    And the student zooms in
    Then the canvas zoom reads "125%"
    When the student resets zoom
    Then the canvas zoom reads "100%"

  Scenario: Pinch zoom resizes without drawing
    Given the study canvas zoom harness is open
    When the student pinches the canvas larger
    Then the canvas zoom reads "150%"
    And no handwriting stroke is created

  Scenario: Zoomed drawing remains aligned with the pen
    Given the study canvas zoom harness is open
    When the student zooms out
    Then drawing coordinates follow the visible zoom scale

  Scenario: Zoomed native drawing remains aligned with the pen
    Given the native Skia handwriting canvas is open at 200% zoom
    When the student writes a transformed stylus stroke
    Then the live ink follows the visible pen location

  Scenario: Zoomed native drawing remains aligned after scrolling
    Given the native Skia handwriting canvas is open at 200% zoom after scrolling
    When the student writes a transformed stylus stroke
    Then the live ink follows the scrolled visible pen location

  Scenario: Native Skia canvas draws live ink safely
    Given the native Skia handwriting canvas is open
    When the student writes a short stylus stroke
    Then the native drawing gesture does not switch gesture state from JavaScript
    And the live ink uses an animated Skia path value

  Scenario: Native Skia canvas sanitizes unsafe drawing input
    Given the native Skia handwriting canvas has malformed strokes
    When the student writes an unsafe stylus stroke
    Then only safe Skia paths and paint values are rendered

  Scenario: Study details collapse so the canvas stays primary
    Given the study canvas zoom harness is open
    Then the study details are hidden
    When the student expands the study details
    Then the study details are visible
    When the student collapses the study details
    Then the study details are hidden

  Scenario: Failed grading appears below the answer in red
    Given the inline grading harness has a failed answer
    When the tutor writes feedback below the answer
    Then the canvas feedback is red
    And the canvas feedback includes "Missing the key cause"

  Scenario: Failed grading feedback remains after pending canvas saves settle
    Given the inline grading harness has a failed answer with a pending stroke save
    When the tutor writes feedback below the answer
    And the pending canvas save settles
    Then the canvas feedback includes "Missing the key cause"
    And only the feedback canvas save is sent

  Scenario: Passing grading appears below the answer in green
    Given the inline grading harness has a passed answer
    When the tutor writes feedback below the answer
    Then the canvas feedback is green
    And the canvas feedback includes "Named the key idea"

  Scenario: Grading feedback creates a canvas page for chat-only answers
    Given the inline grading harness has no canvas pages
    When the tutor writes feedback below the answer
    Then the canvas feedback includes "Missing the key cause"
    And the feedback canvas has one page

  Scenario: Malformed grading feedback is sanitized before rendering on canvas
    Given the inline grading harness has a malformed answer
    When the tutor writes feedback below the answer
    Then the canvas feedback includes "No summary"
    And the canvas feedback includes "42"

  Scenario: Answer bounds stay valid near the canvas edge
    Given the answer bounds harness has edge strokes
    Then the answer bounds read "374,279,26,21"
    And empty answer bounds are unavailable
