import React, { useState } from 'react';
import { styled, keyframes } from '../stitches.config';
import type { AgentPlan, AgentStep } from '../agent/types';

const fadeIn = keyframes({ '0%': { opacity: 0 }, '100%': { opacity: 1 } });

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
});

const StepList = styled('div', { display: 'flex', flexDirection: 'column', gap: '4px' });

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

const StepOutput = styled('div', {
  fontSize: '11px',
  color: '$slate10',
  marginLeft: '24px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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

const BudgetText = styled('div', {
  fontSize: '10px',
  color: '$slate10',
  marginTop: '4px',
  textAlign: 'right',
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
const CorrectionBadge = styled('span', { fontSize: '10px', color: '$amber11', marginLeft: '6px' });

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
  const progress = plan.steps.length > 0 ? (completed / plan.steps.length) * 100 : 0;
  const budgetPct = tokenBudget > 0 ? (tokensUsed / tokenBudget) * 100 : 0;
  const budgetColor = budgetPct >= 100 ? 'red' : budgetPct >= 80 ? 'amber' : 'blue';
  const showApproval = !isRunning && plan.steps.every(s => s.status === 'pending');

  return (
    <AgentCard>
      <GoalHeader>🤖 Goal: {plan.goal}</GoalHeader>
      <StepList>
        {plan.steps.map(step => (
          <div key={step.id}>
            <StepItem done={step.status === 'done'} failed={step.status === 'failed'} running={step.status === 'running'}>
              <StepIcon>{statusIcon(step.status)}</StepIcon>
              <span>{step.id}. {step.description}</span>
              {verbose && (step.correctionAttempts ?? 0) > 0 && <CorrectionBadge>↩️ corrected ({step.correctionAttempts}x)</CorrectionBadge>}
            </StepItem>
            {step.status === 'done' && step.output && (
              <StepOutput
                onClick={() => toggleExpand(step.id)}
                css={{ cursor: 'pointer', '&:hover': { color: '$highContrast' } }}
              >
                {expandedSteps.has(step.id) ? step.output : step.output.slice(0, 120) + (step.output.length > 120 ? '\u2026' : '')}
                {step.output.length > 120 && <span style={{ fontSize: '10px', marginLeft: '4px' }}>{expandedSteps.has(step.id) ? '\u25be' : '\u25b8'}</span>}
              </StepOutput>
            )}
            {verbose && step.correctionReason && <StepOutput css={{ color: '$amber11' }}>↩️ {step.correctionReason}</StepOutput>}
            {step.status === 'failed' && (
              <ButtonRow css={{ marginLeft: '24px', marginTop: '4px' }}>
                {onRetryStep && <Btn variant="approve" onClick={() => onRetryStep(step.id)} css={{ fontSize: '10px', padding: '2px 8px' }}>↻ Retry</Btn>}
                {onSkipStep && <Btn variant="cancel" onClick={() => onSkipStep(step.id)} css={{ fontSize: '10px', padding: '2px 8px' }}>⏭ Skip</Btn>}
              </ButtonRow>
            )}
          </div>
        ))}
      </StepList>

      <BarContainer><BarFill color="blue" css={{ width: `${progress}%` }} /></BarContainer>
      {tokenBudget > 0 && (
        <>
          <BarContainer><BarFill color={budgetColor} css={{ width: `${Math.min(budgetPct, 100)}%` }} /></BarContainer>
          <BudgetText>{tokensUsed.toLocaleString()} / {tokenBudget.toLocaleString()} tokens</BudgetText>
        </>
      )}

      {replanReason && replanSteps && replanSteps.length > 0 && (
        <ReplanBox>
          <ReplanTitle>📋 Plan update proposed</ReplanTitle>
          <ReplanDetail>{replanReason}</ReplanDetail>
          {replanSteps.map(s => <div key={s.id} style={{ fontSize: '11px', color: '#64748b' }}>+ {s.id}. [{s.type}] {s.description}</div>)}
          <ButtonRow>
            <Btn variant="approve" onClick={() => onReplanResponse?.(true)}>✓ Accept</Btn>
            <Btn variant="cancel" onClick={() => onReplanResponse?.(false)}>✕ Keep Original</Btn>
          </ButtonRow>
        </ReplanBox>
      )}

      {escalationQuestion && (
        <EscalationBox>
          <EscalationQuestion>{escalationQuestion}</EscalationQuestion>
          <EscalationInput value={escAnswer} onChange={e => setEscAnswer(e.target.value)} placeholder="Your guidance..." />
          <ButtonRow>
            <Btn variant="submit" onClick={() => { onEscalationResponse(escAnswer); setEscAnswer(''); }}>Submit</Btn>
          </ButtonRow>
        </EscalationBox>
      )}

      <ButtonRow>
        {showApproval && <><Btn variant="approve" onClick={onApprove}>▶️ Approve</Btn><Btn variant="cancel" onClick={onCancel}>✕ Cancel</Btn></>}
        {isRunning && <Btn variant="stop" onClick={onStop}>⏹ Stop</Btn>}
      </ButtonRow>
    </AgentCard>
  );
}
