import { useRef, useState } from 'react';
import type { AgentLoop } from '../agent/AgentLoop';
import type { AgentPlan, AgentStep } from '../agent/types';

export function useAgentController() {
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const agentPlanRef = useRef<AgentPlan | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentTokensUsed, setAgentTokensUsed] = useState(0);
  const [escalationQuestion, setEscalationQuestion] = useState<string | null>(null);
  const agentLoopRef = useRef<AgentLoop | null>(null);
  const escalationResolverRef = useRef<((answer: string) => void) | null>(null);
  const [replanReason, setReplanReason] = useState<string | null>(null);
  const [replanSteps, setReplanSteps] = useState<AgentStep[]>([]);
  const replanResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);

  const [agentModeOn, setAgentModeOn] = useState(() => (logseq.settings?.agentMode as boolean) !== false);
  const [verboseMode, setVerboseMode] = useState(() => (logseq.settings?.agentVerboseMode as boolean) ?? true);

  const handleAgentModeToggle = () => {
    const newMode = !agentModeOn;
    setAgentModeOn(newMode);
    logseq.updateSettings({ agentMode: newMode });
  };

  const handleVerboseToggle = () => {
    const newValue = !verboseMode;
    setVerboseMode(newValue);
    logseq.updateSettings({ agentVerboseMode: newValue });
  };

  return {
    agentPlan,
    setAgentPlan,
    agentPlanRef,
    agentRunning,
    setAgentRunning,
    agentTokensUsed,
    setAgentTokensUsed,
    escalationQuestion,
    setEscalationQuestion,
    agentLoopRef,
    escalationResolverRef,
    replanReason,
    setReplanReason,
    replanSteps,
    setReplanSteps,
    replanResolverRef,
    agentAbortRef,
    agentModeOn,
    verboseMode,
    handleAgentModeToggle,
    handleVerboseToggle,
  };
}

export type AgentController = ReturnType<typeof useAgentController>;
