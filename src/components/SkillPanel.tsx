import React, { useCallback, useEffect, useState } from 'react';
import { styled } from '../stitches.config';
import type { SkillEntry } from '../skills/SkillStore';
import { loadAllSkills, saveSkill, deleteSkill, toggleSkill } from '../skills/SkillStore';
import { importFromGitHub } from '../skills/skillImporter';
import { validateSkillName } from '../skills/skillParser';

const Overlay = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid $slate6',
  flexShrink: 0,
});

const HeaderTitle = styled('h3', {
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
  color: '$highContrast',
});

const CloseBtn = styled('button', {
  background: 'none',
  border: 'none',
  fontSize: '16px',
  cursor: 'pointer',
  color: '$slate9',
  padding: '4px 8px',
  borderRadius: '4px',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

const Content = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 16px',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate6', borderRadius: '3px' },
});

const SkillCard = styled('div', {
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid $slate6',
  marginBottom: '8px',
  backgroundColor: '$slate2',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
});

const SkillHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
});

const SkillName = styled('span', {
  fontWeight: 600,
  fontSize: '13px',
  color: '$highContrast',
  fontFamily: "'JetBrains Mono', monospace",
});

const SkillDesc = styled('p', {
  margin: 0,
  fontSize: '12px',
  color: '$slate11',
  lineHeight: 1.4,
});

const SourceBadge = styled('span', {
  fontSize: '10px',
  padding: '2px 6px',
  borderRadius: '3px',
  backgroundColor: '$blue3',
  color: '$blue11',
  fontWeight: 500,
});

const Toggle = styled('button', {
  width: '36px',
  height: '20px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.2s',
  flexShrink: 0,
  variants: {
    on: {
      true: { backgroundColor: '$green9' },
      false: { backgroundColor: '$slate7' },
    },
  },
  '&::after': {
    content: '',
    position: 'absolute',
    top: '2px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: 'white',
    transition: 'left 0.2s',
  },
});

const ToggleOn = styled(Toggle, {
  '&::after': { left: '18px' },
});

const ToggleOff = styled(Toggle, {
  '&::after': { left: '2px' },
});

const DeleteBtn = styled('button', {
  background: 'none',
  border: 'none',
  fontSize: '12px',
  cursor: 'pointer',
  color: '$red9',
  padding: '2px 6px',
  borderRadius: '4px',
  '&:hover': { backgroundColor: '$red3' },
});

const Section = styled('div', {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid $slate6',
  backgroundColor: '$slate2',
});

const SectionTitle = styled('h4', {
  margin: '0 0 8px 0',
  fontSize: '12px',
  fontWeight: 600,
  color: '$slate11',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
});

const Input = styled('input', {
  width: '100%',
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation0',
  color: '$highContrast',
  fontSize: '12px',
  fontFamily: '$sans',
  outline: 'none',
  '&:focus': { borderColor: '$blue8' },
  '&::placeholder': { color: '$slate8' },
});

const Textarea = styled('textarea', {
  width: '100%',
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation0',
  color: '$highContrast',
  fontSize: '12px',
  fontFamily: '$sans',
  outline: 'none',
  resize: 'vertical',
  minHeight: '60px',
  '&:focus': { borderColor: '$blue8' },
  '&::placeholder': { color: '$slate8' },
});

const Btn = styled('button', {
  padding: '6px 12px',
  borderRadius: '6px',
  border: 'none',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
  variants: {
    variant: {
      primary: {
        backgroundColor: '$blue9',
        color: 'white',
        '&:hover': { backgroundColor: '$blue10' },
        '&:disabled': { opacity: 0.5, cursor: 'default' },
      },
      ghost: {
        backgroundColor: 'transparent',
        color: '$slate11',
        border: '1px solid $slate6',
        '&:hover': { backgroundColor: '$slate3' },
      },
    },
  },
  defaultVariants: { variant: 'primary' },
});

const StatusMsg = styled('div', {
  fontSize: '11px',
  marginTop: '6px',
  padding: '4px 8px',
  borderRadius: '4px',
  variants: {
    type: {
      error: { backgroundColor: '$red3', color: '$red11' },
      success: { backgroundColor: '$green3', color: '$green11' },
    },
  },
});

const EmptyState = styled('div', {
  textAlign: 'center',
  padding: '32px 16px',
  color: '$slate9',
  fontSize: '13px',
});

const Row = styled('div', {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  marginTop: '8px',
});

interface SkillPanelProps {
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

export default function SkillPanel({ onClose, onCountChange }: SkillPanelProps) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createError, setCreateError] = useState('');
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const all = await loadAllSkills();
      // Sort: built-in first, then alphabetical
      all.sort((a, b) => {
        const aBuiltin = a.source === 'builtin' ? 0 : 1;
        const bBuiltin = b.source === 'builtin' ? 0 : 1;
        if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
        return a.name.localeCompare(b.name);
      });
      setSkills(all);
      onCountChange?.(all.filter(s => s.enabled).length);
    } catch (err) {
      console.warn('[SkillPanel] Failed to load skills:', err);
    }
  }, [onCountChange]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleToggle = async (name: string, enabled: boolean) => {
    await toggleSkill(name, !enabled);
    await loadSkills();
  };

  const handleDelete = async (name: string) => {
    await deleteSkill(name);
    setDeletingName(null);
    await loadSkills();
  };

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportStatus(null);
    const result = await importFromGitHub(importUrl.trim());
    if (result.success && result.skill) {
      await saveSkill(result.skill);
      setImportStatus({ type: 'success', msg: `Imported "${result.skill.name}" successfully.` });
      setImportUrl('');
      await loadSkills();
    } else {
      setImportStatus({ type: 'error', msg: result.error || 'Import failed.' });
    }
    setImporting(false);
  };

  const handleCreate = async () => {
    setCreateError('');
    const validation = validateSkillName(createName);
    if (!validation.valid) {
      setCreateError(validation.error || 'Invalid name');
      return;
    }
    if (!createDesc.trim()) {
      setCreateError('Description is required');
      return;
    }
    if (!createBody.trim()) {
      setCreateError('Instructions body is required');
      return;
    }
    await saveSkill({
      name: createName,
      description: createDesc.trim(),
      enabled: true,
      body: createBody.trim(),
    });
    setCreateName('');
    setCreateDesc('');
    setCreateBody('');
    setShowCreate(false);
    await loadSkills();
  };

  const ToggleSwitch = ({ on, onClick }: { on: boolean; onClick: () => void }) => {
    const Comp = on ? ToggleOn : ToggleOff;
    return <Comp on={on} onClick={onClick} />;
  };

  return (
    <Overlay>
      <Header>
        <HeaderTitle>🧩 Skills</HeaderTitle>
        <CloseBtn onClick={onClose}>✕</CloseBtn>
      </Header>
      <Content>
        {skills.length === 0 && (
          <EmptyState>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🧩</div>
            <div>No skills installed yet.</div>
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#6b7280' }}>
              Import from GitHub or create one manually below.
            </div>
          </EmptyState>
        )}

        {skills.map(skill => {
          const isBuiltin = skill.source === 'builtin';
          return (
          <SkillCard key={skill.name} css={isBuiltin ? { borderColor: '$violet6', backgroundColor: '$violet2' } : undefined}>
            <SkillHeader>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <SkillName>{skill.name}</SkillName>
                {isBuiltin && <SourceBadge css={{ backgroundColor: '$violet3', color: '$violet11' }}>⚙️ Built-in</SourceBadge>}
                {!isBuiltin && skill.source?.startsWith('github:') && <SourceBadge>📦 GitHub</SourceBadge>}
                {!isBuiltin && skill.source && !skill.source.startsWith('github:') && !isBuiltin && <SourceBadge>📝 Local</SourceBadge>}
                {!isBuiltin && !skill.source && <SourceBadge>📝 Local</SourceBadge>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <ToggleSwitch on={skill.enabled} onClick={() => handleToggle(skill.name, skill.enabled)} />
                {!isBuiltin && (
                  deletingName === skill.name ? (
                    <>
                      <DeleteBtn onClick={() => handleDelete(skill.name)}>Confirm</DeleteBtn>
                      <DeleteBtn onClick={() => setDeletingName(null)} style={{ color: 'inherit' }}>Cancel</DeleteBtn>
                    </>
                  ) : (
                    <DeleteBtn onClick={() => setDeletingName(skill.name)}>🗑️</DeleteBtn>
                  )
                )}
              </div>
            </SkillHeader>
            <SkillDesc>{skill.description}</SkillDesc>
            {isBuiltin && <div style={{ fontSize: '10px', color: '#8b5cf6', marginTop: '2px' }}>Auto-managed by Mixer · updated with plugin versions</div>}
          </SkillCard>
          );
        })}

        <Section>
          <SectionTitle>📥 Import from GitHub</SectionTitle>
          <Input
            placeholder="https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md"
            value={importUrl}
            onChange={e => setImportUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleImport(); }}
          />
          <Row>
            <Btn onClick={handleImport} disabled={importing || !importUrl.trim()} variant="primary">
              {importing ? '⏳ Importing...' : '📥 Import'}
            </Btn>
          </Row>
          {importStatus && <StatusMsg type={importStatus.type}>{importStatus.msg}</StatusMsg>}
        </Section>

        <Section>
          <SectionTitle
            style={{ cursor: 'pointer' }}
            onClick={() => setShowCreate(prev => !prev)}
          >
            {showCreate ? '▾' : '▸'} ✨ Create New Skill
          </SectionTitle>
          {showCreate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Input
                placeholder="skill-name (lowercase, hyphens only)"
                value={createName}
                onChange={e => setCreateName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
              <Textarea
                placeholder="Description: what this skill does and when to use it"
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                style={{ minHeight: '40px' }}
              />
              <Textarea
                placeholder="Instructions body (markdown). This is what the AI receives when the skill is activated."
                value={createBody}
                onChange={e => setCreateBody(e.target.value)}
                style={{ minHeight: '100px' }}
              />
              {createError && <StatusMsg type="error">{createError}</StatusMsg>}
              <Row>
                <Btn onClick={handleCreate} variant="primary">✨ Create Skill</Btn>
                <Btn onClick={() => setShowCreate(false)} variant="ghost">Cancel</Btn>
              </Row>
            </div>
          )}
        </Section>
      </Content>
    </Overlay>
  );
}
