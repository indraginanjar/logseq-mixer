import React from 'react';
import { styled } from '../stitches.config';

const StyledPageLink = styled('span', {
  color: '$blue11',
  cursor: 'pointer',
  display: 'inline',
  '&:hover': {
    textDecoration: 'underline',
  },
});

type PageLinkProps = {
  pageName: string;
  children?: React.ReactNode;
};

export function PageLink({ pageName, children }: PageLinkProps): JSX.Element {
  const handleClick = () => {
    try {
      logseq.App.pushState('page', { name: pageName });
    } catch (error) {
      console.error('Failed to navigate to page:', pageName, error);
    }
  };

  return (
    <StyledPageLink onClick={handleClick}>
      {children ?? `[[${pageName}]]`}
    </StyledPageLink>
  );
}
