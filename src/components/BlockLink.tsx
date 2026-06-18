import React from 'react';
import { styled } from '../stitches.config';

const StyledBlockLink = styled('span', {
  color: '$teal11',
  cursor: 'pointer',
  display: 'inline',
  '&:hover': {
    textDecoration: 'underline',
  },
});

type BlockLinkProps = {
  blockUuid: string;
  label?: string;
  pageName?: string;
  children?: React.ReactNode;
};

export function BlockLink({ blockUuid, label, pageName, children }: BlockLinkProps): JSX.Element {
  const handleClick = () => {
    try {
      if (pageName) {
        logseq.Editor.scrollToBlockInPage(pageName, blockUuid);
      } else {
        logseq.Editor.scrollToBlockInPage(blockUuid, blockUuid);
      }
    } catch (error) {
      console.error('Failed to navigate to block:', blockUuid, error);
    }
  };

  const isPlaceholder =
    typeof children === 'string' &&
    (children.startsWith('block:') || children === `((${blockUuid}))`);
  const displayText = isPlaceholder ? (label ?? children) : (children ?? label) ?? `${blockUuid.slice(0, 8)}…`;

  return (
    <StyledBlockLink onClick={handleClick}>
      {displayText}
    </StyledBlockLink>
  );
}
