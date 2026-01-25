# AI Tutor Graph Improvements

To make the AI-generated graphs more helpful for learning, we need to move beyond simple connectivity and focus on **educational clarity**, **visual semantics**, and **active engagement**.

The following plan outlines improvements to the `CanvasDiagram` component, the data structure, and the AI prompts.

---

## 1. Visual Semantics (The "Visual Language")

Currently, the AI chooses colors and shapes somewhat randomly. We should enforce a consistent visual language that lowers cognitive load for the student.

### Semantic Schema

We will update the `feynmanSystemPrompt` to use these specific conventions:

| Learning Element | Shape | Color | Purpose |
| :--- | :--- | :--- | :--- |
| **Core Concept** | `box` (Rect) | `blue` | The main topic or entity being discussed. |
| **Action / Process** | `box` (Rounded) | `solid` (default) | Steps in a workflow or causal link. |
| **Decision / Logic** | `diamond` | `purple` | Branching points, "If X then Y". |
| **Example / Instance** | `ellipse` | `green` | Concrete real-world examples of a concept. |
| **Warning / Myth** | `diamond` / `box` | `red` | Common misconceptions or things to avoid. |
| **Start / End** | `circle` | `orange` | Entry and exit points of a process. |

### Implementation
1. Update `types/index.ts` to include more semantic purpose fields or strict shape/color mapping.
2. Update `components/canvas-diagram.tsx` to render these styles distinctly.

---

## 2. Layout & Readability Improvements

The current grid-based `tree` layout is fragile.

### Short-term: Directed Acyclic Graph (DAG) Hints
We can ask the AI to provide a `level` or `rank` explicitly, or infer it better.

**Prompt Update:**
> "For hierarchical concepts, organize nodes into levels. Use 'layout': 'tree'."

### Mid-term: Better Layout Algorithm
Replace the simple grid logic in `calculateNodePositions` with a proper tree algorithm (like Reingold-Tilford) or a lightweight force-directed approach.

*   **Tree/Hierarchy**: Ensure parent nodes are centered above children.
*   **Flowchart**: Maintain left-to-right or top-to-bottom flow strictly.
*   **Edge Routing**: Use orthogonal connectors (elbow lines) instead of straight lines for cleaner "engineering" look.

---

## 3. Active Learning Features (Interactivity)

Static graphs are good; interactive graphs are better for retention.

### A. "Fill-in-the-Blanks" (Cloze Deletion)
We can ask the AI to generate "quiz graphs" where key keywords are hidden.

**Data Structure Change:**
```typescript
interface DiagramNode {
  // ...
  hiddenLabel?: string; // The specific answer
  isMasked?: boolean;   // If true, render as "???" or blurred
}
```

**User Flow:**
1. AI sends a graph of a process (e.g., "Krebs Cycle").
2. Key steps are masked.
3. User taps a node to "Reveal" it (and self-check).

### B. Expandable Nodes (Drill-down)
Allow nodes to hold extra details that appear on tap.

**Data Structure Change:**
```typescript
interface DiagramNode {
  // ...
  description?: string; // Long-form explanation
}
```

**User Flow:**
1. Student sees a high-level map (e.g., "Software Architecture").
2. Taps "Database" node.
3. A modal or bottom sheet appears with the detailed definition or a sub-graph.

---

## 4. Prompt Engineering Updates

We need to explicitly teach the AI this new capability in `lib/prompts.ts`.

### Updated System Prompt Section (Draft)
```text
**VISUAL CANVAS RULES:**
1. **Semantics**:
   - Use "box" (Blue) for Core Concepts.
   - Use "diamond" (Purple) for Decisions or "If/Then" logic.
   - Use "ellipse" (Green) for Examples.
   - Use "box" (Red) for Misconceptions/Errors.
   
2. **Layouts**:
   - Use "tree" for hierarchies (classifications, family trees).
   - Use "vertical" for sequential processes (step 1 -> step 2).

3. **Active Learning**:
   - To test the student, you can set "masked": true on key nodes. The label should be a hint (e.g. "Step 3?"), and put the real answer in "hiddenLabel".
```

---

## 5. Execution Plan

### Phase 1: Semantics & Styles (Quick Win)
- [x] Modify `feynmanSystemPrompt` in `lib/prompts.ts` to define the shape/color schema.
- [x] Update `components/canvas-diagram.tsx` to handle `rounded-box` if needed (or just map to shapes).
- [ ] Tweaking existing layout constants for better spacing.

### Phase 2: Interactivity
- [x] Add `description` and `masked` fields to `DiagramNode` type.
- [x] Add `onNodePress` handler in `CanvasDiagram` to show a `Alert` or `Modal` with details/unmasking.
- [x] Update parser to handle these new fields.

### Phase 3: Advanced Layouts
- [x] Integrate `dagre` for professional-grade layout.
- [x] Support multi-point edge routing for cleaner diagrams.
