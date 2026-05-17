const JSON_FENCE_REGEX = /```[ \t]*(?:json)?[ \t]*\n([\s\S]*?)```/i;

const findFirstJsonValue = (text: string): string | null => {
  for (let start = 0; start < text.length; start += 1) {
    const firstChar = text[start];
    if (firstChar !== "{" && firstChar !== "[") continue;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        stack.push("}");
        continue;
      }

      if (char === "[") {
        stack.push("]");
        continue;
      }

      if (char !== "}" && char !== "]") continue;

      if (stack.pop() !== char) break;

      if (stack.length === 0) {
        const candidate = text.slice(start, index + 1).trim();
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          break;
        }
      }
    }
  }

  return null;
};

export const stripCodeFences = (text: string) => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(JSON_FENCE_REGEX);
  if (fenceMatch) return fenceMatch[1].trim();

  return findFirstJsonValue(trimmed) ?? trimmed;
};
