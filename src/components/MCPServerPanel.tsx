import React, { useEffect, useState } from 'react';
import { styled, keyframes } from '../stitches.config';
import { MCPManager } from '../mcp/MCPManager';
import { MCPClientStatus } from '../mcp/MCPClient';

const fadeIn = keyframes({
  '0%': { opacity: 0 },
  '100%': { opacity: 1 },
});

const slideDown = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const PanelContainer = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 20px',
  animation: `${fadeIn} 0.2s ease-out`,
});

const PanelHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px',
  borderBottom: '1px solid $slate6',
  paddingBottom: '10px',
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
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  paddingRight: '4px',
});

const HelpText = styled('p', {
  fontSize: '12px',
  color: '$slate11',
  margin: '0 0 12px 0',
  lineHeight: 1.4,
});

const ServerCard = styled('div', {
  border: '1px solid $slate5',
  borderRadius: '8px',
  backgroundColor: '$slate2',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

const ServerHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: '$slate3',
  },
});

const ServerInfo = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
});

const StatusIndicator = styled('span', {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  display: 'inline-block',
  variants: {
    status: {
      connected: { backgroundColor: '$green9' },
      connecting: { backgroundColor: '$amber9' },
      disconnected: { backgroundColor: '$slate9' },
      error: { backgroundColor: '$red9' },
    },
  },
});

const ServerName = styled('span', {
  fontSize: '14px',
  fontWeight: 600,
  color: '$highContrast',
});

const ToolCount = styled('span', {
  fontSize: '11px',
  color: '$slate11',
  fontWeight: 400,
});

const HeaderRight = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const CaretIcon = styled('span', {
  fontSize: '12px',
  color: '$slate11',
  transition: 'transform 0.2s',
  variants: {
    expanded: {
      true: { transform: 'rotate(180deg)' },
    },
  },
});

const ToolListContainer = styled('div', {
  borderTop: '1px solid $slate5',
  backgroundColor: '$elevation0',
  padding: '6px 14px',
  animation: `${slideDown} 0.15s ease-out both`,
});

const ToolItem = styled('div', {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid $slate4',
  '&:last-child': {
    borderBottom: 'none',
  },
});

const ToolDetails = styled('div', {
  flex: 1,
  paddingRight: '16px',
});

const ToolName = styled('h4', {
  margin: '0 0 2px 0',
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
});

const ToolDesc = styled('p', {
  margin: 0,
  fontSize: '11px',
  color: '$slate11',
  lineHeight: 1.4,
});

const EmptyToolState = styled('div', {
  padding: '16px 0',
  textAlign: 'center',
  fontSize: '12px',
  color: '$slate10',
});

const ErrorMessage = styled('div', {
  padding: '0 14px 12px 14px',
  fontSize: '11px',
  color: '$red11',
  lineHeight: 1.4,
});

// Toggle Switch Components
const SwitchContainer = styled('label', {
  position: 'relative',
  display: 'inline-block',
  width: '34px',
  height: '18px',
  cursor: 'pointer',
  flexShrink: 0,
  marginTop: '2px',
});

const SwitchInput = styled('input', {
  opacity: 0,
  width: 0,
  height: 0,
});

const SwitchSlider = styled('span', {
  position: 'absolute',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: '$slate6',
  transition: '0.2s',
  borderRadius: '18px',
  '&:before': {
    position: 'absolute',
    content: '""',
    height: '12px',
    width: '12px',
    left: '3px',
    bottom: '3px',
    backgroundColor: 'white',
    transition: '0.2s',
    borderRadius: '50%',
  },
  variants: {
    active: {
      true: {
        backgroundColor: '$blue9',
        '&:before': {
          transform: 'translateX(16px)',
        },
      },
    },
  },
});

interface MCPServerPanelProps {
  onClose: () => void;
}

export default function MCPServerPanel({ onClose }: MCPServerPanelProps) {
  const manager = MCPManager.getInstance();
  const [servers, setServers] = useState(manager.getServers());
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Sync UI with manager updates (e.g. connections, status, tool listings)
    const unsubscribe = manager.subscribeClientsChange(() => {
      setServers(manager.getServers());
    });
    // Trigger first settings check/sync
    manager.syncWithSettings();
    setServers(manager.getServers());
    return unsubscribe;
  }, [manager]);

  const toggleExpand = (name: string) => {
    setExpandedServers((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  const handleToggleTool = (serverName: string, toolName: string, enabled: boolean) => {
    manager.toggleTool(serverName, toolName, enabled);
  };

  const getStatusLabel = (status: MCPClientStatus): string => {
    switch (status) {
      case 'connected': return 'online';
      case 'connecting': return 'connecting…';
      case 'disconnected': return 'offline';
      case 'error': return 'error';
    }
  };

  return (
    <PanelContainer>
      <PanelHeader>
        <PanelTitle>🔌 MCP Servers Manager</PanelTitle>
        <CloseButton onClick={onClose} aria-label="Close MCP Panel">✕</CloseButton>
      </PanelHeader>

      <HelpText>
        Configure server settings via Logseq Plugin settings. Actively connected servers expose tools that the AI assistant can execute during chat.
      </HelpText>

      <ScrollableArea>
        {servers.length === 0 ? (
          <EmptyToolState style={{ padding: '24px 0', border: '1px dashed $slate6', borderRadius: '8px' }}>
            No MCP Servers configured.<br />
            Configure MCP Servers JSON in settings to start.
          </EmptyToolState>
        ) : (
          servers.map((client) => {
            const isExpanded = expandedServers[client.name];
            const isConnected = client.status === 'connected';
            const enabledCount = client.tools.filter(t => manager.isToolEnabled(client.name, t.name)).length;
            const totalCount = client.tools.length;

            const hasError = client.status === 'error';
            const showToggle = isConnected || hasError;

            return (
              <ServerCard key={client.name} style={!isConnected && !hasError ? { opacity: 0.75 } : undefined}>
                <ServerHeader onClick={() => showToggle && toggleExpand(client.name)}>
                  <ServerInfo>
                    <StatusIndicator status={client.status} />
                    <ServerName style={!isConnected ? { color: '$slate9' } : undefined}>
                      {client.name}
                    </ServerName>
                    <ToolCount>
                      {isConnected 
                        ? `(${enabledCount}/${totalCount} active)` 
                        : `(${getStatusLabel(client.status)})`}
                    </ToolCount>
                  </ServerInfo>
                  {showToggle && (
                    <HeaderRight>
                      <CaretIcon expanded={isExpanded}>▼</CaretIcon>
                    </HeaderRight>
                  )}
                </ServerHeader>

                {isExpanded && hasError && client.errorMessage && (
                  <ErrorMessage>{client.errorMessage}</ErrorMessage>
                )}

                {isExpanded && isConnected && (
                  <ToolListContainer>
                    {client.tools.length === 0 ? (
                      <EmptyToolState>No tools declared by this server.</EmptyToolState>
                    ) : (
                      client.tools.map((tool) => {
                        const isEnabled = manager.isToolEnabled(client.name, tool.name);
                        return (
                          <ToolItem key={tool.name}>
                            <ToolDetails>
                              <ToolName>{tool.name}</ToolName>
                              {tool.description && <ToolDesc>{tool.description}</ToolDesc>}
                            </ToolDetails>
                            <SwitchContainer>
                              <SwitchInput
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => handleToggleTool(client.name, tool.name, e.target.checked)}
                              />
                              <SwitchSlider active={isEnabled} />
                            </SwitchContainer>
                          </ToolItem>
                        );
                      })
                    )}
                  </ToolListContainer>
                )}
              </ServerCard>
            );
          })
        )}
      </ScrollableArea>
    </PanelContainer>
  );
}
