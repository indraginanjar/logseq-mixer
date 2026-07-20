export type StepType = 'read' | 'write' | 'search' | 'tool' | 'think' | 'gather' | 'specialist' | 'subgoal' | 'recall';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface AgentStep {
  id: number;
  description: string;
  type: StepType;
  tool?: string;
  /** For specialist steps: the focused role/instruction for the specialist LLM call */
  specialistRole?: string;
  /** For specialist steps: which prior step IDs to include as input (empty = none, uses description only) */
  inputSteps?: number[];
  /** Step IDs that must complete before this step can execute. If absent/empty, step has no dependencies. */
  dependsOn?: number[];
  /** For specialist steps: tool access level ('read-only' | 'full' | 'none'). Default: 'read-only' */
  specialistTools?: 'read-only' | 'full' | 'none';
  /** Optional model hint: 'fast', 'quality', or a literal model name */
  model?: string;
  /** For subgoal steps: configuration for the child agent */
  subgoalConfig?: { canWrite?: boolean; maxSteps?: number; maxDepth?: number };
  status: StepStatus;
  output?: string;
  error?: string;
  tokensUsed?: number;
  correctionAttempts?: number;
  correctionReason?: string;
}

export interface AgentPlan {
  goal: string;
  steps: AgentStep[];
  estimatedTokens: number;
}

export interface StepResult {
  success: boolean;
  output: string;
  tokensUsed: number;
  error?: string;
}

export interface StepOutputMetadata {
  pageNames?: string[];
  blockUUIDs?: string[];
  tokenCount?: number;
  model?: string;
}

export interface StepOutput {
  stepId: number;
  type: 'text' | 'data' | 'error' | 'request';
  content: string;
  structured?: Record<string, any>;
  metadata?: StepOutputMetadata;
}

export interface StepContext {
  previousOutputs: StepOutput[];
  createdBlockUUIDs: string[];
  createdPages: string[];
  goal: string;
  /** Working memory for Map-Reduce: accumulates structured data across gather steps */
  scratchPad: Map<string, string>;
}

export type ProgressEventType =
  | 'plan_ready'
  | 'step_start'
  | 'step_complete'
  | 'step_failed'
  | 'escalate'
  | 'budget_warning'
  | 'complete'
  | 'aborted'
  | 'self_correcting'
  | 'replan_proposed'
  | 'replan_approved'
  | 'subgoal_start'
  | 'subgoal_complete'
  | 'memory_recalled'
  | 'memory_stored';

export interface AgentProgressEvent {
  type: ProgressEventType;
  step?: AgentStep;
  message: string;
  tokensUsed: number;
  totalSteps: number;
  completedSteps: number;
  plan?: AgentPlan;
  question?: string;
  replanSteps?: AgentStep[];
}

export type AutonomyLevel = 'plan-first' | 'autopilot';
