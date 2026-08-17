import React, { useState, useEffect } from 'react';
import { styled, keyframes } from '../stitches.config';
import { loadAgents, createAgent, updateAgent, deleteAgent, duplicateAgent, getActiveAgentId, setActiveAgentId } from '../agents/AgentConfigStore';
import type { AgentConfig } from '../agents/AgentConfigStore';
import { MCPManager } from '../mcp/MCPManager';
import { loadAllSkills } from '../skills/SkillStore';

// --- Animations ---

const fadeIn = keyframes({ '0%': { opacity: 0 }, '100%': { opacity: 1 } });
const slideDown = keyframes({ '0%': { opacity: 0, transform: 'translateY(-4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } });

// --- Styled Components ---

const PanelContainer = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  boxSizing: 'border-box',
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 20px',
  animation: `${fadeIn} 0.2s ease-out`,
  overflow: 'hidden',
});

const PanelHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px',
  borderBottom: '1px solid $slate6',
  paddingBottom: '10px',
  flexShrink: 0,
});

const PanelTitle = styled('h3', {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '$highContrast',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const HeaderButtons = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const HeaderButton = styled('button', {
  background: 'none',
  border: '1px solid $slate6',
  borderRadius: '4px',
  fontSize: '11px',
  color: '$slate11',
  cursor: 'pointer',
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': {
    backgroundColor: '$slate4',
    color: '$highContrast',
    borderColor: '$slate8',
  },
});

const CloseButton = styled('button', {
  background: 'none',
  border: 'none',
  fontSize: '16px',
  color: '$slate11',
  cursor: 'pointer',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  '&:hover': {
    backgroundColor: '$slate4',
    color: '$highContrast',
  },
});

const ScrollableArea = styled('div', {
  flex: 1,
  height: 0,
  overflowY: 'scroll',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingRight: '4px',
  boxSizing: 'border-box',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate8', borderRadius: '3px' },
});

const AgentCard = styled('div', {
  border: '1px solid $slate5',
  borderRadius: '8px',
  backgroundColor: '$slate2',
  padding: '10px 12px',
  animation: `${slideDown} 0.15s ease-out both`,
});

const CardTop = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
});

const AgentInfo = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: 1,
  minWidth: 0,
});

const AgentIcon = styled('span', {
  fontSize: '20px',
  flexShrink: 0,
});

const AgentName = styled('span', {
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const AgentDescription = styled('p', {
  margin: '4px 0 0',
  fontSize: '11px',
  color: '$slate10',
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const ActiveBadge = styled('span', {
  fontSize: '10px',
  fontWeight: 600,
  borderRadius: '4px',
  padding: '2px 6px',
  backgroundColor: '$green3',
  color: '$green11',
  textTransform: 'uppercase',
  flexShrink: 0,
});

const ActionButtons = styled('div', {
  display: 'flex',
  gap: '4px',
  flexShrink: 0,
});

const IconBtn = styled('button', {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '2px 4px',
  borderRadius: '4px',
  color: '$slate11',
  '&:hover': { backgroundColor: '$slate4', color: '$highContrast' },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed', '&:hover': { backgroundColor: 'transparent' } },
});

// --- Form Styled Components ---

const FormContainer = styled('div', {
  border: '1px solid $blue6',
  borderRadius: '8px',
  backgroundColor: '$slate2',
  padding: '14px',
  animation: `${slideDown} 0.15s ease-out both`,
});

const FormTitle = styled('h4', {
  margin: '0 0 12px',
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
});

const FormField = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  marginBottom: '10px',
});

const FormLabel = styled('label', {
  fontSize: '11px',
  fontWeight: 500,
  color: '$slate11',
});

const FormInput = styled('input', {
  width: '100%',
  fontSize: '12px',
  padding: '6px 8px',
  borderRadius: '4px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation0',
  color: '$highContrast',
  boxSizing: 'border-box',
  '&:focus': { outline: 'none', borderColor: '$blue8' },
  '&::placeholder': { color: '$slate9' },
});

const FormTextarea = styled('textarea', {
  width: '100%',
  minHeight: '120px',
  fontSize: '12px',
  padding: '6px 8px',
  borderRadius: '4px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation0',
  color: '$highContrast',
  boxSizing: 'border-box',
  resize: 'vertical',
  fontFamily: 'monospace',
  lineHeight: 1.5,
  '&:focus': { outline: 'none', borderColor: '$blue8' },
  '&::placeholder': { color: '$slate9' },
});

const FormButtons = styled('div', {
  display: 'flex',
  gap: '8px',
  marginTop: '12px',
});

const SaveButton = styled('button', {
  fontSize: '11px',
  fontWeight: 500,
  padding: '5px 12px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '$blue9',
  color: 'white',
  cursor: 'pointer',
  '&:hover': { backgroundColor: '$blue10' },
  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
});

const CancelButton = styled('button', {
  fontSize: '11px',
  fontWeight: 500,
  padding: '5px 12px',
  borderRadius: '4px',
  border: '1px solid $slate6',
  backgroundColor: 'transparent',
  color: '$slate11',
  cursor: 'pointer',
  '&:hover': { backgroundColor: '$slate4', color: '$highContrast' },
});

// --- Delete Confirmation ---

const DeleteOverlay = styled('div', {
  position: 'absolute',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
  animation: `${fadeIn} 0.15s ease-out`,
});

const DeleteDialog = styled('div', {
  backgroundColor: '$elevation0',
  border: '1px solid $slate6',
  borderRadius: '8px',
  padding: '16px 20px',
  maxWidth: '300px',
  width: '90%',
  textAlign: 'center',
});

const DeleteTitle = styled('p', {
  margin: '0 0 12px',
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
});

const DeleteMessage = styled('p', {
  margin: '0 0 16px',
  fontSize: '12px',
  color: '$slate11',
});

const DeleteButtons = styled('div', {
  display: 'flex',
  gap: '8px',
  justifyContent: 'center',
});

const DeleteConfirmBtn = styled('button', {
  fontSize: '11px',
  fontWeight: 500,
  padding: '5px 12px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '$red9',
  color: 'white',
  cursor: 'pointer',
  '&:hover': { backgroundColor: '$red10' },
});

const EmptyState = styled('div', {
  textAlign: 'center',
  padding: '24px',
  color: '$slate10',
  fontSize: '12px',
});

// --- Component ---

interface AgentPanelProps {
  onClose: () => void;
  onAgentChange: () => void;
}

export default function AgentPanel({ onClose, onAgentChange }: AgentPanelProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState('🤖');
  const [formDescription, setFormDescription] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formProvider, setFormProvider] = useState('');
  const [formToolStates, setFormToolStates] = useState<Record<string, boolean>>({});
  const [formSkillActivations, setFormSkillActivations] = useState<string[]>([]);

  // Available tools and skills (loaded when form opens)
  const [availableTools, setAvailableTools] = useState<Array<{ serverName: string; toolName: string }>>([]);
  const [availableSkills, setAvailableSkills] = useState<Array<{ name: string; description: string }>>([]);

  const activeAgentId = getActiveAgentId();

  const refreshAgents = () => {
    setAgents(loadAgents());
  };

  useEffect(() => {
    refreshAgents();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormIcon('🤖');
    setFormDescription('');
    setFormSystemPrompt('');
    setFormModel('');
    setFormProvider('');
    setFormToolStates({});
    setFormSkillActivations([]);
    setError(null);
  };

  const loadAvailableToolsAndSkills = async () => {
    // Load available MCP tools from connected servers
    const mcpManager = MCPManager.getInstance();
    const servers = mcpManager.getServers();
    const tools: Array<{ serverName: string; toolName: string }> = [];
    servers.forEach(client => {
      if (client.status === 'connected') {
        client.tools.forEach(tool => {
          tools.push({ serverName: client.name, toolName: tool.name });
        });
      }
    });
    setAvailableTools(tools);

    // Load available skills
    try {
      const skills = await loadAllSkills();
      setAvailableSkills(skills.map(s => ({ name: s.name, description: s.description })));
    } catch {
      setAvailableSkills([]);
    }
  };

  const handleCreate = () => {
    setEditingAgent(null);
    setIsCreating(true);
    resetForm();
    loadAvailableToolsAndSkills();
  };

  const handleEdit = (agent: AgentConfig) => {
    setIsCreating(false);
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormIcon(agent.icon || '🤖');
    setFormDescription(agent.description || '');
    setFormSystemPrompt(agent.systemPrompt);
    setFormModel(agent.model || '');
    setFormProvider(agent.provider || '');
    setFormToolStates({ ...agent.mcpToolStates });
    setFormSkillActivations([...agent.skillActivations]);
    setError(null);
    loadAvailableToolsAndSkills();
  };

  const handleCancelForm = () => {
    setEditingAgent(null);
    setIsCreating(false);
    resetForm();
  };

  const handleSave = () => {
    if (!formName.trim()) {
      setError('Name is required');
      return;
    }

    try {
      if (isCreating) {
        createAgent({
          name: formName.trim(),
          icon: formIcon || '🤖',
          description: formDescription.trim() || undefined,
          systemPrompt: formSystemPrompt,
          model: formModel.trim() || null,
          provider: formProvider.trim() || null,
          mcpToolStates: formToolStates,
          skillActivations: formSkillActivations,
          isDefault: false,
        });
      } else if (editingAgent) {
        updateAgent(editingAgent.id, {
          name: formName.trim(),
          icon: formIcon || '🤖',
          description: formDescription.trim() || undefined,
          systemPrompt: formSystemPrompt,
          model: formModel.trim() || null,
          provider: formProvider.trim() || null,
          mcpToolStates: formToolStates,
          skillActivations: formSkillActivations,
        });
      }

      handleCancelForm();
      refreshAgents();
      onAgentChange();
    } catch (err: any) {
      setError(err.message || 'Failed to save agent');
    }
  };

  const handleDuplicate = (id: string) => {
    try {
      duplicateAgent(id);
      refreshAgents();
      onAgentChange();
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate agent');
    }
  };

  const handleDeleteConfirm = () => {
    if (!confirmDelete) return;
    try {
      deleteAgent(confirmDelete);
      setConfirmDelete(null);
      refreshAgents();
      onAgentChange();
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent');
    }
  };

  const isFormOpen = isCreating || editingAgent !== null;

  return (
    <PanelContainer>
      <PanelHeader>
        <PanelTitle>🤖 Agents</PanelTitle>
        <HeaderButtons>
          <HeaderButton onClick={handleCreate} disabled={isFormOpen}>
            + Create Agent
          </HeaderButton>
          <CloseButton onClick={onClose} title="Close">✕</CloseButton>
        </HeaderButtons>
      </PanelHeader>

      {error && (
        <div style={{ marginBottom: '10px', padding: '6px 10px', borderRadius: '4px', fontSize: '11px', backgroundColor: 'var(--colors-red3)', color: 'var(--colors-red11)', border: '1px solid var(--colors-red6)' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '11px' }}>✕</button>
        </div>
      )}

      <ScrollableArea>
        {/* Inline form for creating/editing */}
        {isFormOpen && (
          <FormContainer>
            <FormTitle>{isCreating ? 'Create Agent' : `Edit: ${editingAgent?.name}`}</FormTitle>

            <FormField>
              <FormLabel>Name *</FormLabel>
              <FormInput
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Agent name"
                autoFocus
              />
            </FormField>

            <FormField>
              <FormLabel>Icon</FormLabel>
              <FormInput
                value={formIcon}
                onChange={e => setFormIcon(e.target.value)}
                placeholder="🤖"
                style={{ width: '60px' }}
              />
            </FormField>

            <FormField>
              <FormLabel>Description</FormLabel>
              <FormInput
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Brief description (optional)"
              />
            </FormField>

            <FormField>
              <FormLabel>System Prompt</FormLabel>
              <FormTextarea
                value={formSystemPrompt}
                onChange={e => setFormSystemPrompt(e.target.value)}
                placeholder="System prompt for this agent..."
              />
            </FormField>

            <FormField>
              <FormLabel>Model Override</FormLabel>
              <FormInput
                value={formModel}
                onChange={e => setFormModel(e.target.value)}
                placeholder="Leave empty to use global model"
              />
            </FormField>

            <FormField>
              <FormLabel>Provider Override</FormLabel>
              <FormInput
                value={formProvider}
                onChange={e => setFormProvider(e.target.value)}
                placeholder="Leave empty to use global provider"
              />
            </FormField>

            {/* MCP Tool States */}
            {availableTools.length > 0 && (
              <FormField>
                <FormLabel>MCP Tool Access</FormLabel>
                <div style={{ fontSize: '11px', color: 'var(--colors-slate9)', marginBottom: '4px' }}>
                  Override which tools this agent can use. Unchecked tools use the global setting.
                </div>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--colors-slate6)', borderRadius: '4px', padding: '4px' }}>
                  {availableTools.map(({ serverName, toolName }) => {
                    const key = `${serverName}:${toolName}`;
                    const hasOverride = key in formToolStates;
                    const isEnabled = hasOverride ? formToolStates[key] : true;
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 4px', fontSize: '11px' }}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={e => {
                            setFormToolStates(prev => ({ ...prev, [key]: e.target.checked }));
                          }}
                          style={{ margin: 0 }}
                        />
                        <span style={{ color: 'var(--colors-slate9)', fontSize: '10px' }}>{serverName}:</span>
                        <span>{toolName}</span>
                        {hasOverride && (
                          <button
                            onClick={() => {
                              setFormToolStates(prev => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                            }}
                            title="Reset to global"
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', color: 'var(--colors-slate9)' }}
                          >↺</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </FormField>
            )}

            {/* Skill Activations */}
            {availableSkills.length > 0 && (
              <FormField>
                <FormLabel>Auto-Activate Skills</FormLabel>
                <div style={{ fontSize: '11px', color: 'var(--colors-slate9)', marginBottom: '4px' }}>
                  Skills to automatically activate when this agent handles a query.
                </div>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--colors-slate6)', borderRadius: '4px', padding: '4px' }}>
                  {availableSkills.map(skill => {
                    const isActive = formSkillActivations.includes(skill.name);
                    return (
                      <div key={skill.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 4px', fontSize: '11px' }}>
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={e => {
                            if (e.target.checked) {
                              setFormSkillActivations(prev => [...prev, skill.name]);
                            } else {
                              setFormSkillActivations(prev => prev.filter(s => s !== skill.name));
                            }
                          }}
                          style={{ margin: 0 }}
                        />
                        <span>{skill.name}</span>
                        {skill.description && (
                          <span style={{ color: 'var(--colors-slate9)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            — {skill.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </FormField>
            )}

            <FormButtons>
              <SaveButton onClick={handleSave} disabled={!formName.trim()}>
                {isCreating ? 'Create' : 'Save'}
              </SaveButton>
              <CancelButton onClick={handleCancelForm}>Cancel</CancelButton>
            </FormButtons>
          </FormContainer>
        )}

        {/* Agent list */}
        {agents.length === 0 && !isFormOpen && (
          <EmptyState>No agents configured. Click "Create Agent" to get started.</EmptyState>
        )}

        {agents.map(agent => (
          <AgentCard key={agent.id}>
            <CardTop>
              <AgentInfo>
                <AgentIcon>{agent.icon || '🤖'}</AgentIcon>
                <AgentName>{agent.name}</AgentName>
                {agent.id === activeAgentId && <ActiveBadge>Active</ActiveBadge>}
              </AgentInfo>
              <ActionButtons>
                <IconBtn onClick={() => handleEdit(agent)} title="Edit">✏️</IconBtn>
                <IconBtn onClick={() => handleDuplicate(agent.id)} title="Duplicate">📋</IconBtn>
                <IconBtn
                  onClick={() => setConfirmDelete(agent.id)}
                  title="Delete"
                  disabled={agent.isDefault}
                >🗑️</IconBtn>
              </ActionButtons>
            </CardTop>
            {agent.description && <AgentDescription>{agent.description}</AgentDescription>}
          </AgentCard>
        ))}
      </ScrollableArea>

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <DeleteOverlay onClick={() => setConfirmDelete(null)}>
          <DeleteDialog onClick={e => e.stopPropagation()}>
            <DeleteTitle>Delete Agent?</DeleteTitle>
            <DeleteMessage>
              This will permanently remove the agent. This action cannot be undone.
            </DeleteMessage>
            <DeleteButtons>
              <DeleteConfirmBtn onClick={handleDeleteConfirm}>Delete</DeleteConfirmBtn>
              <CancelButton onClick={() => setConfirmDelete(null)}>Cancel</CancelButton>
            </DeleteButtons>
          </DeleteDialog>
        </DeleteOverlay>
      )}
    </PanelContainer>
  );
}
