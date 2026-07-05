import React, { useState } from 'react';
import { styled, keyframes } from '../stitches.config';
import type { AgentPlan, AgentStep } from '../agent/types';

const fadeIn = keyframes({ '0%': { opacity: 0 }, '100%': { opacity: 1 } });
const pulse = keyframes({ '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } });

const AgentCard = styled('div', {
  border: '1px solid $slate5',
  borderRadius: '8px',
  backgroundColor: '$slate2',
  padding: '14px 16px',
  margin: '8px 0',
  animation: `${fadeIn} 0.2s ease-out`,
});

const GoalHeader = styled('div', {
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
  marginBottom: '10px',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const StepList = styled('div', { display: 'flex', flexDirection: 'column', gap: '2px' });

const StepItem = styled('div', {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '12px',
  color: '$slate11',
  padding: '4px 0',
  variants: {
    done: { true: { color: '$green11' } },
    failed: { true: { color: '$red11' } },
    running: { true: { color: '$blue11', fontWeight: 500 } },
  },
});

const StepIcon = styled('span', { fontSize: '12px', flexShrink: 0, width: '16px' });

const StepDescription = styled('span', { flex: 1 });

const StepMeta = styled('span', {
  fontSize: '10px',
  color: '$slate9',
  marginLeft: '4px',
  fontWeight: 400,
});

const StepOutput = styled('div', {
  fontSize: '11px',
  color: '$slate10',
  marginLeft: '24px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.5,
  padding: '4px 8px',
  borderLeft: '2px solid $slate4',
  marginTop: '2px',
  marginBottom: '4px',
});

const VerboseDetail = styled('div', {
  fontSize: '11px',
  marginLeft: '24px',
  padding: '4px 8px',
  borderLeft: '2px solid',
  marginTop: '2px',
  marginBottom: '4px',
  lineHeight: 1.4,
  variants: {
    variant: {
      correction: { borderColor: '$amber7', color: '$amber11', backgroundColor: '$amber2' },
      info: { borderColor: '$blue7', color: '$blue11', backgroundColor: '$blue2' },
      error: { borderColor: '$red7', color: '$red11', backgroundColor: '$red2' },
      success: { borderColor: '$green7', color: '$green11', backgroundColor: '$green2' },
    },
  },
});

const VerboseLabel = styled('span', {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginRight: '6px',
});

const TypeBadge = styled('span', {
  fontSize: '9px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '1px 5px',
  borderRadius: '3px',
  variants: {
    type: {
      read: { backgroundColor: '$blue3', color: '$blue11' },
      write: { backgroundColor: '$green3', color: '$green11' },
      search: { backgroundColor: '$violet3', color: '$violet11' },
      tool: { backgroundColor: '$orange3', color: '$orange11' },
      think: { backgroundColor: '$slate4', color: '$slate11' },
    },
  },
});

const CorrectionBadge = styled('span', {
  fontSize: '10px',
  fontWeight: 500,
  color: '$amber11',
  backgroundColor: '$amber3',
  padding: '1px 6px',
  borderRadius: '3px',
  marginLeft: '6px',
});

const BarContainer = styled('div', {
  height: '4px',
  backgroundColor: '$slate4',
  borderRadius: '2px',
  marginTop: '10px',
  overflow: 'hidden',
});

const BarFill = styled('div', {
  height: '100%',
  borderRadius: '2px',
  transition: 'width 0.3s',
  variants: {
    color: {
      blue: { backgroundColor: '$blue9' },
      amber: { backgroundColor: '$amber9' },
      red: { backgroundColor: '$red9' },
    },
  },
});

const ProgressSummary = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '6px',
  fontSize: '10px',
  color: '$slate10',
});

const ButtonRow = styled('div', {
  display: 'flex',
  gap: '8px',
  marginTop: '10px',
});

const Btn = styled('button', {
  fontSize: '12px',
  padding: '5px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 500,
  border: 'none',
  variants: {
    variant: {
      approve: { backgroundColor: '$blue9', color: 'white', '&:hover': { backgroundColor: '$blue10' } },
      cancel: { backgroundColor: 'transparent', border: '1px solid $slate6', color: '$slate11', '&:hover': { backgroundColor: '$slate4' } },
      stop: { backgroundColor: '$red9', color: 'white', '&:hover': { backgroundColor: '$red10' } },
      submit: { backgroundColor: '$green9', color: 'white', '&:hover': { backgroundColor: '$green10' } },
    },
  },
});

const EscalationBox = styled('div', {
  marginTop: '10px',
  padding: '10px',
  backgroundColor: '$amber3',
  borderRadius: '6px',
  border: '1px solid $amber6',
});

const EscalationQuestion = styled('div', { fontSize: '12px', color: '$amber11', marginBottom: '6px' });

const EscalationInput = styled('textarea', {
  width: '100%',
  minHeight: '40px',
  fontSize: '12px',
  padding: '6px',
  border: '1px solid $slate6',
  borderRadius: '4px',
  backgroundColor: '$elevation1',
  color: '$highContrast',
  resize: 'vertical',
  outline: 'none',
  fontFamily: 'inherit',
  '&:focus': { borderColor: '$blue9' },
});

const ReplanBox = styled('div', {
  marginTop: '10px',
  padding: '10px',
  backgroundColor: '$blue3',
  borderRadius: '6px',
  border: '1px solid $blue6',
});

const ReplanTitle = styled('div', { fontSize: '12px', fontWeight: 600, color: '$blue11', marginBottom: '6px' });
const ReplanDetail = styled('div', { fontSize: '11px', color: '$slate11', marginBottom: '8px' });

const RunningIndicator = styled('span', {
  animation: `${pulse} 1.5s ease-in-out infinite`,
});

function statusIcon(status: string): string {
  switch (status) {
    case 'pending': return '⏳';
    case 'running': return '🔄';
    case 'done': return '✅';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '·';
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface AgentProgressProps {
  plan: AgentPlan | null;
  onApprove: () => void;
  onCancel: () => void;
  onStop: () => void;
  onEscalationResponse: (answer: string) => void;
  tokensUsed: number;
  tokenBudget: number;
  escalationQuestion: string | null;
  isRunning: boolean;
  onReplanResponse?: (approved: boolean) => void;
  replanReason?: string | null;
  replanSteps?: AgentStep[];
  verbose?: boolean;
  onRetryStep?: (stepId: number) => void;
  onSkipStep?: (stepId: number) => void;
}

export default function AgentProgress({ plan, onApprove, onCancel, onStop, onEscalationResponse, tokensUsed, tokenBudget, escalationQuestion, isRunning, onReplanResponse, replanReason, replanSteps, verbose, onRetryStep, onSkipStep }: AgentProgressProps) {
  const [escAnswer, setEscAnswer] = useState('');
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const toggleExpand = (stepId: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
      return next;
    });
  };
  if (!plan) return null;

  const completed = plan.steps.filter(s => s.status === 'done').length;
  const failed = plan.steps.filter(s => s.status === 'failed').length;
  const progress = plan.steps.length > 0 ? (completed / plan.steps.length) * 100 : 0;
  const budgetPct = tokenBudget > 0 ? (tokensUsed / tokenBudget) * 100 : 0;
  const budgetColor = budgetPct >= 100 ? 'red' : budgetPct >= 80 ? 'amber' : 'blue';
  const showApproval = !isRunning && plan.steps.every(s => s.status === 'pending');

  return (
    <AgentCard>
      <GoalHeader>
        {isRunning ? <RunningIndicator>🤖</RunningIndicator> : '🤖'}
        <span>Goal: {plan.goal}</span>
      </GoalHeader>

      <StepList>
        {plan.steps.map(step => (
          <div key={step.id}>
            <StepItem done={step.status === 'done'} failed={step.status === 'failed'} running={step.status === 'running'}>
              <StepIcon>{statusIcon(step.status)}</StepIcon>
              <StepDescription>
                {step.id}. {step.description}
                {verbose && <TypeBadge type={step.type as any}>{step.type}</TypeBadge>}
                {verbose && step.tokensUsed ? <StepMeta>({formatTokens(step.tokensUsed)} tok)</StepMeta> : null}
              </StepDescription>
              {verbose && (step.correctionAttempts ?? 0) > 0 && (
                <CorrectionBadge>↩ corrected ×{step.correctionAttempts}</CorrectionBadge>
              )}
            </StepItem>

            {/* Verbose: show correction reasoning */}
            {verbose && step.correctionReason && (
              <VerboseDetail variant="correction">
                <VerboseLabel>Correction:</VerboseLabel>
                {step.correctionReason}
              </VerboseDetail>
            )}

            {/* Step output (expandable) */}
            {step.status === 'done' && step.output && (
              <StepOutput
                onClick={() => toggleExpand(step.id)}
                css={{ cursor: 'pointer', '&:hover': { color: '$highContrast', borderColor: '$slate6' } }}
              >
                {expandedSteps.has(step.id) ? step.output : step.output.slice(0, 120) + (step.output.length > 120 ? '…' : '')}
                {step.output.length > 120 && <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.7 }}>{expandedSteps.has(step.id) ? '▾ collapse' : '▸ expand'}</span>}
              </StepOutput>
            )}

            {/* Verbose: show error details for failed steps */}
            {verbose && step.status === 'failed' && step.error && (
              <VerboseDetail variant="error">
                <VerboseLabel>Error:</VerboseLabel>
                {step.error}
              </VerboseDetail>
            )}

            {/* Retry/Skip buttons for failed steps */}
            {step.status === 'failed' && (
              <ButtonRow css={{ marginLeft: '24px', marginTop: '4px' }}>
                {onRetryStep && <Btn variant="approve" onClick={() => onRetryStep(step.id)} css={{ fontSize: '10px', padding: '2px 8px' }}>↻ Retry</Btn>}
                {onSkipStep && <Btn variant="cancel" onClick={() => onSkipStep(step.id)} css={{ fontSize: '10px', padding: '2px 8px' }}>⏭ Skip</Btn>}
              </ButtonRow>
            )}
          </div>
        ))}
      </StepList>

      {/* Progress bar */}
      <BarContainer><BarFill color="blue" css={{ width: `${progress}%` }} /></BarContainer>

      {/* Token budget bar + summary */}
      {tokenBudget > 0 && (
        <BarContainer css={{ marginTop: '4px' }}><BarFill color={budgetColor} css={{ width: `${Math.min(budgetPct, 100)}%` }} /></BarContainer>
      )}

      <ProgressSummary>
        <span>
          {completed}/{plan.steps.length} steps
          {failed > 0 && <span style={{ color: 'var(--colors-red11)', marginLeft: '6px' }}>{failed} failed</span>}
        </span>
        {verbose && tokenBudget > 0 && (
          <span>{formatTokens(tokensUsed)} / {formatTokens(tokenBudget)} tokens</span>
        )}
        {verbose && tokenBudget === 0 && tokensUsed > 0 && (
          <span>{formatTokens(tokensUsed)} tokens used</span>
        )}
      </ProgressSummary>

      {/* Replan proposal */}
      {replanReason && replanSteps && replanSteps.length > 0 && (
        <ReplanBox>
          <ReplanTitle>📋 Plan update proposed</ReplanTitle>
          <ReplanDetail>{replanReason}</ReplanDetail>
          {replanSteps.map(s => (
            <div key={s.id} style={{ fontSize: '11px', color: '#64748b', padding: '1px 0' }}>
              + {s.id}. <TypeBadge type={s.type as any}>{s.type}</TypeBadge> {s.description}
            </div>
          ))}
          <ButtonRow>
            <Btn variant="approve" onClick={() => onReplanResponse?.(true)}>✓ Accept</Btn>
            <Btn variant="cancel" onClick={() => onReplanResponse?.(false)}>✕ Keep Original</Btn>
          </ButtonRow>
        </ReplanBox>
      )}

      {/* Escalation dialog */}
      {escalationQuestion && (
        <EscalationBox>
          <EscalationQuestion>{escalationQuestion}</EscalationQuestion>
          <EscalationInput value={escAnswer} onChange={e => setEscAnswer(e.target.value)} placeholder="Your guidance..." />
          <ButtonRow>
            <Btn variant="submit" onClick={() => { onEscalationResponse(escAnswer); setEscAnswer(''); }}>Submit</Btn>
          </ButtonRow>
        </EscalationBox>
      )}

      {/* Action buttons */}
      <ButtonRow>
        {showApproval && <><Btn variant="approve" onClick={onApprove}>▶️ Approve</Btn><Btn variant="cancel" onClick={onCancel}>✕ Cancel</Btn></>}
        {isRunning && <Btn variant="stop" onClick={onStop}>⏹ Stop</Btn>}
      </ButtonRow>
    </AgentCard>
  );
}
