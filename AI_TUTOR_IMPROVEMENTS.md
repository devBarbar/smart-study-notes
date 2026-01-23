# AI Tutor Improvement Plan

## Current State

The AI Tutor currently provides:
- Plain text/markdown responses in a chat panel
- LaTeX math rendering via `MarkdownText` component
- Auto-written questions on the handwriting canvas
- Text-to-speech (TTS) for spoken explanations
- Streaming responses for real-time feedback

### Limitations
- Responses are **free text only** - no visual structure
- No interactive elements within messages
- Limited visual aids for complex concepts
- No inline quizzes or checkpoints

---

## Proposed Improvements

### 1. Structured Content Blocks
**Impact: High | Effort: Medium**

Add rich visual blocks that the AI can generate using special markdown syntax:

| Block Type | Syntax | Purpose |
|------------|--------|---------|
| Definition Card | `:::definition` | Highlighted boxes for key terms |
| Step-by-Step | `:::steps` | Numbered steps with progress indicators |
| Tip Callout | `:::tip` | Helpful hints in colored boxes |
| Warning Callout | `:::warning` | Important cautions/common mistakes |
| Example Card | `:::example` | Collapsible worked examples |
| Formula Card | `:::formula` | Highlighted equations with explanations |
| Comparison Table | `:::compare` | Side-by-side comparisons |

**Example Usage:**
```markdown
:::definition
**Derivative**: The instantaneous rate of change of a function at a point. 
Notation: $f'(x)$ or $\frac{df}{dx}$
:::

:::steps
1. Identify the function $f(x)$
2. Apply the power rule: $\frac{d}{dx}x^n = nx^{n-1}$
3. Simplify the result
:::

:::tip
Remember: The derivative of a constant is always zero!
:::
```

---

### 2. Inline Interactive Elements
**Impact: High | Effort: Higher**

Embed interactive components directly in the chat:

#### Mini-Quizzes
```markdown
:::quiz
What is the derivative of $x^3$?
- [ ] $x^2$
- [x] $3x^2$
- [ ] $3x^3$
- [ ] $x^4$
:::
```

#### Collapsible Hints
```markdown
:::hint
Click to reveal a hint...
>>>
Try using the power rule: bring down the exponent and subtract 1.
:::
```

#### Understanding Checkpoints
```markdown
:::checkpoint
Did you understand this concept?
[Yes, continue] [Need more explanation] [Show an example]
:::
```

#### Glossary Links
- Tap any **highlighted term** to see its definition
- Build a personal glossary as you learn

---

### 3. Visual Diagrams
**Impact: Medium | Effort: Medium**

#### Mermaid Diagram Support
```markdown
:::diagram
graph TD
    A[Input x] --> B[Apply function f]
    B --> C[Get output f(x)]
    C --> D[Calculate derivative]
    D --> E[Output f'(x)]
:::
```

#### Concept Maps
- Show relationships between ideas
- Visual hierarchy of topics
- Interactive zoom/pan

#### ASCII Diagrams
Quick inline visualizations for simple concepts:
```
    y
    │    ╱
    │   ╱  slope = rise/run
    │  ╱
    │ ╱
    └──────── x
```

---

### 4. Canvas Integration
**Impact: High | Effort: Higher**

Make the AI interact with the handwriting canvas:

#### AI Annotations
- AI can **draw directly** on the canvas
- Highlight areas with colored overlays
- Add arrows pointing to relevant notes

#### Visual Walkthroughs
- Step through solutions visually
- Animate diagram creation
- Show work as it's being explained

#### Smart Linking
- Click on AI explanation → highlights relevant canvas area
- Click on canvas notes → shows related chat messages

---

### 5. Progress & Feedback
**Impact: Medium | Effort: Low**

#### Understanding Checkpoints
- Quick polls after explanations
- Track which concepts need review
- Adaptive difficulty based on responses

#### Mini-Quiz Results
- Score tracking per session
- Spaced repetition integration
- Weak area identification

#### Mastery Indicators
- Visual progress bars per concept
- Achievement badges for milestones
- Streak rewards for consistent study

---

### 6. Enhanced Formatting
**Impact: Medium | Effort: Low**

#### Color-Coded Categories
- Definitions in blue
- Formulas in purple
- Examples in green
- Warnings in orange

#### Highlighted Key Terms
- Bold important concepts
- Underline testable items
- Tap-to-define functionality

#### Better Code Blocks
- Syntax highlighting
- Copy button
- Line numbers for reference

---

## Implementation Priority

### Phase 1: Quick Wins
1. **Callout boxes** (tip, warning, definition)
2. **Collapsible sections** for examples
3. **Better visual hierarchy** in responses

### Phase 2: Rich Content
4. **Step-by-step cards** with numbering
5. **Formula cards** with explanations
6. **Comparison tables**

### Phase 3: Interactivity
7. **Inline mini-quizzes**
8. **Understanding checkpoints**
9. **Glossary links**

### Phase 4: Advanced
10. **Mermaid diagram rendering**
11. **Canvas annotations**
12. **Visual walkthroughs**

---

## Technical Approach

### Option A: Custom Markdown Extensions
Extend the existing `MarkdownText` component to recognize custom syntax:

```typescript
// Detect :::blocktype patterns and render custom components
const customBlocks = {
  'definition': DefinitionCard,
  'steps': StepByStepCard,
  'tip': TipCallout,
  'warning': WarningCallout,
  'quiz': InlineQuiz,
  'example': CollapsibleExample,
};
```

### Option B: Structured JSON Responses
Have the AI return structured JSON that maps to components:

```json
{
  "blocks": [
    { "type": "text", "content": "Let me explain derivatives..." },
    { "type": "definition", "term": "Derivative", "definition": "..." },
    { "type": "steps", "items": ["Step 1...", "Step 2..."] },
    { "type": "quiz", "question": "...", "options": [...] }
  ]
}
```

### Option C: Hybrid Approach
Use markdown with embedded JSON for complex blocks:

```markdown
Here's the concept:

```json:definition
{"term": "Derivative", "definition": "..."}
```

Now let's practice:

```json:quiz
{"question": "...", "options": [...]}
```
```

---

## Prompt Updates Required

Update `feynmanSystemPrompt` to instruct the AI to use structured blocks:

```typescript
// Add to guidelines:
- Use :::definition blocks for key terms
- Use :::steps blocks for procedures
- Use :::tip for helpful hints
- Use :::warning for common mistakes
- Use :::example for worked examples (collapsible)
- Include :::checkpoint after complex explanations
```

---

## Files to Modify

1. **`components/markdown-text.tsx`** - Add custom block rendering
2. **`lib/prompts.ts`** - Update system prompts
3. **`supabase/functions/_shared/prompts.ts`** - Sync prompt changes
4. **`app/study/[sessionId].tsx`** - Handle interactive elements
5. **`components/` (new files)**:
   - `definition-card.tsx`
   - `step-card.tsx`
   - `callout-box.tsx`
   - `inline-quiz.tsx`
   - `collapsible-example.tsx`

---

## Success Metrics

- **Engagement**: Time spent per session increases
- **Comprehension**: Quiz scores improve
- **Retention**: Spaced repetition performance
- **User Feedback**: Qualitative satisfaction ratings
