import type { StepOutput, StepType } from './types';

/**
 * Parse raw step output into a structured StepOutput object.
 * Extracts JSON data, page names, block UUIDs, and request markers.
 */
export function parseStepOutput(stepId: number, rawOutput: string, stepType: StepType): StepOutput {
  const output: StepOutput = {
    stepId,
    type: 'text',
    content: rawOutput,
  };

  // Detect error outputs
  if (rawOutput.startsWith('Error:') || rawOutput.startsWith('Failed:')) {
    output.type = 'error';
    return output;
  }

  // Detect request outputs
  if (rawOutput.startsWith('REQUEST:') || rawOutput.includes('"type":"request"')) {
    output.type = 'request';
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        output.structured = JSON.parse(jsonMatch[0]);
      }
    } catch { /* ignore parse errors */ }
    return output;
  }

  // Extract structured JSON data (look for ```json blocks or raw JSON objects)
  const jsonBlockMatch = rawOutput.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      output.structured = JSON.parse(jsonBlockMatch[1]);
      output.type = 'data';
    } catch { /* ignore */ }
  } else {
    // Try to detect if the entire output is valid JSON
    const trimmed = rawOutput.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        output.structured = JSON.parse(trimmed);
        output.type = 'data';
      } catch { /* ignore */ }
    }
  }

  // Extract metadata
  const metadata: StepOutput['metadata'] = {};

  // Detect page names from [[...]] patterns
  const pageMatches = rawOutput.match(/\[\[([^\]]+)\]\]/g);
  if (pageMatches) {
    metadata.pageNames = [...new Set(pageMatches.map(m => m.slice(2, -2)))];
  }

  // Detect block UUIDs (standard uuid format)
  const uuidMatches = rawOutput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuidMatches) {
    metadata.blockUUIDs = [...new Set(uuidMatches)];
  }

  if (Object.keys(metadata).length > 0) {
    output.metadata = metadata;
  }

  return output;
}
